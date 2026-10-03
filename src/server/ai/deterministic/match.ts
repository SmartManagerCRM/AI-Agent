/**
 * Deterministic-first matchers (spec §7): "Do not interpret every customer
 * message as requiring an LLM call." Pure functions — no I/O — so they are
 * unit-testable without a database; `gateway.ts` builds the `BrainSnapshot`
 * from real Phase 2 data and only reaches for the AI provider when nothing
 * here matches. Each rule is deliberately narrow: it is meant to catch the
 * common, low-ambiguity cases (spec §7's own example — "Add two Cokes" needs
 * no model), not to approximate general understanding.
 */
import { detectLang, matchCatalog, type Catalog } from "./catalog";

export type OpeningHoursDay = { open: string; close: string }[];

export type BrainSnapshot = {
  locale: string;
  assistantName: string | null;
  greeting: string | null;
  /** The greeting saved per language; absent = `greeting` for every language. */
  greetings?: Partial<Record<"en" | "ar" | "fr", string>>;
  currency: string;
  currencyExponent: number;
  products: { name: string; priceMinor: number }[];
  defaultBranch: { name: string; phone: string | null; openingHours: Record<string, OpeningHoursDay> } | null;
  /** entry_type -> best-available-locale text, for about/delivery/pickup/payment/policy notes. */
  notes: Partial<Record<"about" | "delivery_info" | "pickup_info" | "payment_methods" | "policy", string>>;
  /** FAQ entries: entry_key (hyphenated keywords) -> best-available-locale answer text. */
  faqs: { entryKey: string; answer: string }[];
  /**
   * Owner-APPROVED Business Discovery facts only (never pending suggestions,
   * never unresolved conflicts). Optional: absent when nothing is approved.
   */
  facts?: {
    name?: string;
    operationalStatus?: string;
    phone?: string;
    whatsapp?: string;
    email?: string;
    website?: string;
    address?: string;
    openingHours?: Record<string, OpeningHoursDay>;
    hoursNote?: string;
    capabilities: string[];
    /** "Name — 18.00 SAR" lines: information only, not orderable unless also a catalog product. */
    offerings: string[];
  };
  /** This exact conversation's own real past orders (never another customer's) — null for a first-time visitor. */
  returningCustomer: { orderCount: number; topProducts: string[] } | null;
  /** The structured live catalog (ids, categories, descriptions) for deterministic menu/product answers. */
  catalog?: Catalog;
  /** Approved Business Brain entries loaded for this Agent (diagnostics). */
  knowledgeCount?: number;
};

/** `productIds`: real catalog products the reply is about — rendered as product cards. */
export type DeterministicMatch = { rule: string; reply: string; productIds?: string[]; resultCount?: number };

const GREETING_WORDS = ["hi", "hello", "hey", "hola", "مرحبا", "أهلا", "salut", "bonjour"];
const THANKS_WORDS = ["thanks", "thank you", "thx", "شكرا", "merci"];
const HOURS_WORDS = ["hour", "hours", "open", "close", "closing", "متى", "ساعات", "heures", "ouvert"];
const DELIVERY_WORDS = ["deliver", "delivery", "توصيل", "livraison"];
const PICKUP_WORDS = ["pickup", "pick up", "collect", "استلام", "retrait"];
const PAYMENT_WORDS = ["pay", "payment", "cash", "card", "دفع", "paiement"];

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

type Lang = ReturnType<typeof detectLang>;

/** These replies in the customer's language (the one they write in, else the conversation's). */
const T: Record<Lang, {
  thanks: string;
  hello: (name: string | null) => string;
  open: (place: string, ranges: string) => string;
  closed: (place: string) => string;
  price: (name: string, price: string) => string;
}> = {
  en: {
    thanks: "You're welcome!",
    hello: (name) => `Hello! I'm your assistant${name ? ` ${name}` : ""}. How can I help?`,
    open: (place, ranges) => `${place} is open today ${ranges}.`,
    closed: (place) => `${place} is closed today.`,
    price: (name, price) => `${name} is ${price}.`,
  },
  ar: {
    thanks: "على الرحب والسعة!",
    hello: (name) => `أهلاً! أنا مساعدك${name ? ` ${name}` : ""}. كيف يمكنني مساعدتك؟`,
    open: (place, ranges) => `${place} مفتوح اليوم ${ranges}.`,
    closed: (place) => `${place} مغلق اليوم.`,
    price: (name, price) => `سعر ${name}: ${price}.`,
  },
  fr: {
    thanks: "Avec plaisir !",
    hello: (name) => `Bonjour ! Je suis votre assistant${name ? ` ${name}` : ""}. Comment puis-je vous aider ?`,
    open: (place, ranges) => `${place} est ouvert aujourd'hui ${ranges}.`,
    closed: (place) => `${place} est fermé aujourd'hui.`,
    price: (name, price) => `${name} coûte ${price}.`,
  },
};

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

function containsAny(message: string, words: string[]): boolean {
  const normalized = normalize(message);
  return words.some((word) => normalized.includes(word));
}

export function matchDeterministic(
  message: string,
  snapshot: BrainSnapshot,
  context: { recent?: string[] } = {},
): DeterministicMatch | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  const lang = detectLang(trimmed, snapshot.locale);

  if (containsAny(trimmed, THANKS_WORDS)) {
    return { rule: "thanks", reply: T[lang].thanks };
  }

  if (trimmed.length <= 20 && containsAny(trimmed, GREETING_WORDS)) {
    return { rule: "greeting", reply: (snapshot.greetings ? snapshot.greetings[lang] : snapshot.greeting) || T[lang].hello(snapshot.assistantName) };
  }

  if (containsAny(trimmed, HOURS_WORDS)) {
    // The branch's own hours win; otherwise the owner-approved discovered hours.
    const hoursSource =
      snapshot.defaultBranch && Object.keys(snapshot.defaultBranch.openingHours ?? {}).length > 0
        ? snapshot.defaultBranch
        : snapshot.facts?.openingHours
          ? { name: snapshot.facts.name ?? "We", phone: snapshot.facts.phone ?? null, openingHours: snapshot.facts.openingHours }
          : snapshot.defaultBranch;
    const reply = describeOpeningHours(hoursSource, lang);
    if (reply) return { rule: "opening_hours", reply };
  }

  if (containsAny(trimmed, DELIVERY_WORDS) && snapshot.notes.delivery_info) {
    return { rule: "delivery_info", reply: snapshot.notes.delivery_info };
  }

  if (containsAny(trimmed, PICKUP_WORDS) && snapshot.notes.pickup_info) {
    return { rule: "pickup_info", reply: snapshot.notes.pickup_info };
  }

  if (containsAny(trimmed, PAYMENT_WORDS) && snapshot.notes.payment_methods) {
    return { rule: "payment_methods", reply: snapshot.notes.payment_methods };
  }

  const faqMatch = matchFaq(trimmed, snapshot);
  if (faqMatch) return faqMatch;

  if (snapshot.catalog) {
    return matchCatalog(trimmed, snapshot.catalog, { recent: context.recent, infoOfferings: snapshot.facts?.offerings });
  }
  return matchProductPrice(trimmed, snapshot, lang);
}

export function describeOpeningHours(branch: BrainSnapshot["defaultBranch"], lang: Lang = "en"): string | null {
  if (!branch) return null;
  const today = WEEKDAY_KEYS[(new Date().getDay() + 6) % 7]; // getDay(): 0=Sun -> map to mon-first index
  const slots = branch.openingHours[today];
  if (!slots || slots.length === 0) return T[lang].closed(branch.name);
  // Times stay left-to-right inside an Arabic sentence.
  const ranges = slots.map((slot) => `${slot.open}–${slot.close}`).join(", ");
  return T[lang].open(branch.name, lang === "ar" ? `\u2066${ranges}\u2069` : ranges);
}

function matchProductPrice(message: string, snapshot: BrainSnapshot, lang: Lang): DeterministicMatch | null {
  const normalized = normalize(message);
  for (const product of snapshot.products) {
    const name = normalize(product.name);
    if (name.length >= 3 && normalized.includes(name)) {
      const price = (product.priceMinor / 10 ** snapshot.currencyExponent).toFixed(snapshot.currencyExponent);
      return { rule: "product_price", reply: T[lang].price(product.name, `${price} ${snapshot.currency}`) };
    }
  }
  return null;
}

function matchFaq(message: string, snapshot: BrainSnapshot): DeterministicMatch | null {
  const normalized = normalize(message);
  for (const faq of snapshot.faqs) {
    const keywords = faq.entryKey.split("-").filter((word) => word.length > 2);
    if (keywords.length > 0 && keywords.every((word) => normalized.includes(word))) {
      return { rule: `faq:${faq.entryKey}`, reply: faq.answer };
    }
  }
  return null;
}
