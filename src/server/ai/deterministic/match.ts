/**
 * Deterministic-first matchers (spec §7): "Do not interpret every customer
 * message as requiring an LLM call." Pure functions — no I/O — so they are
 * unit-testable without a database; `gateway.ts` builds the `BrainSnapshot`
 * from real Phase 2 data and only reaches for the AI provider when nothing
 * here matches. Each rule is deliberately narrow: it is meant to catch the
 * common, low-ambiguity cases (spec §7's own example — "Add two Cokes" needs
 * no model), not to approximate general understanding.
 */
import { matchCatalog, type Catalog } from "./catalog";

export type OpeningHoursDay = { open: string; close: string }[];

export type BrainSnapshot = {
  locale: string;
  assistantName: string | null;
  greeting: string | null;
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

  if (containsAny(trimmed, THANKS_WORDS)) {
    return { rule: "thanks", reply: "You're welcome!" };
  }

  if (trimmed.length <= 20 && containsAny(trimmed, GREETING_WORDS)) {
    const name = snapshot.assistantName ? ` ${snapshot.assistantName}` : "";
    return { rule: "greeting", reply: snapshot.greeting || `Hello! I'm your assistant${name}. How can I help?` };
  }

  if (containsAny(trimmed, HOURS_WORDS)) {
    // The branch's own hours win; otherwise the owner-approved discovered hours.
    const hoursSource =
      snapshot.defaultBranch && Object.keys(snapshot.defaultBranch.openingHours ?? {}).length > 0
        ? snapshot.defaultBranch
        : snapshot.facts?.openingHours
          ? { name: snapshot.facts.name ?? "We", phone: snapshot.facts.phone ?? null, openingHours: snapshot.facts.openingHours }
          : snapshot.defaultBranch;
    const reply = describeOpeningHours(hoursSource);
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
  return matchProductPrice(trimmed, snapshot);
}

export function describeOpeningHours(branch: BrainSnapshot["defaultBranch"]): string | null {
  if (!branch) return null;
  const today = WEEKDAY_KEYS[(new Date().getDay() + 6) % 7]; // getDay(): 0=Sun -> map to mon-first index
  const slots = branch.openingHours[today];
  if (!slots || slots.length === 0) return `${branch.name} is closed today.`;
  const ranges = slots.map((slot) => `${slot.open}–${slot.close}`).join(", ");
  return `${branch.name} is open today ${ranges}.`;
}

function matchProductPrice(message: string, snapshot: BrainSnapshot): DeterministicMatch | null {
  const normalized = normalize(message);
  for (const product of snapshot.products) {
    const name = normalize(product.name);
    if (name.length >= 3 && normalized.includes(name)) {
      const price = (product.priceMinor / 10 ** snapshot.currencyExponent).toFixed(snapshot.currencyExponent);
      return { rule: "product_price", reply: `${product.name} is ${price} ${snapshot.currency}.` };
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
