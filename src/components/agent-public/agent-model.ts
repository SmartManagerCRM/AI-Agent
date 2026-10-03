/**
 * Presentation-only types and helpers for the Customer Agent UI. Nothing
 * here decides a price, an availability, a cart total or an AI answer —
 * it only shapes data the server already returned for display.
 */

export type LocalizedText = Record<string, string>;

export type AgentCategory = { id: string; name: LocalizedText };

export type AgentProduct = {
  id: string;
  categoryId: string | null;
  name: LocalizedText;
  description: LocalizedText;
  priceMinor: number;
  /** The product's photo (our own storage), null when it has none. */
  imageUrl?: string | null;
};

export type AgentService = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  /** null = no fixed length. */
  durationMinutes: number | null;
  priceMinor: number | null;
  priceUnit: "booking" | "hour" | "person";
  /** People who can be booked at the same time. */
  capacity: number;
  /** The customer chooses their time out (or a duration). */
  customerSetsEnd: boolean;
  /** The business confirms each booking itself: the customer waits for its answer. */
  requiresApproval: boolean;
};

export type FulfillmentType = "pickup" | "delivery" | "dine_in";

export type AgentBusinessInfo = {
  /** Default branch's localized name, when one is configured. */
  branchName: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  /** Today's opening intervals ("07:00–23:59"), `[]` when the branch is closed today, null when no hours are configured. */
  todayHours: string[] | null;
};

/** `name[locale]`, then the business's default language, then whatever exists — never an invented label. */
export function pickText(text: LocalizedText | null | undefined, locale: string, fallbackLocale: string): string {
  if (!text) return "";
  return text[locale] ?? text[fallbackLocale] ?? Object.values(text)[0] ?? "";
}

const CATEGORY_ICONS: [RegExp, string][] = [
  [/coffee|caf[eé]|espresso|latte|قهوة|كوفي/i, "☕\uFE0F"],
  [/\btea\b|th[eé]\b|شاي/i, "🍵"],
  [/juice|jus|عصير/i, "🧃"],
  [/drink|beverage|boisson|مشروب/i, "🥤"],
  [/breakfast|petit[- ]d[eé]j|فطور/i, "🍳"],
  [/burger|برجر/i, "🍔"],
  [/pizza|بيتزا/i, "🍕"],
  [/sandwich|ساندو/i, "🥪"],
  [/salad|salade|سلط/i, "🥗"],
  [/pastr|bakery|boulang|viennois|croissant|معجنات|مخبوزات/i, "🥐"],
  [/dessert|sweet|cake|g[aâ]teau|p[aâ]tiss|حلو|كيك/i, "🍰"],
  [/food|meal|plat|dish|main|طعام|وجبات|أطباق|اطباق/i, "🍽️"],
  [/offer|promo|deal|sale|عرض|عروض|تخفيض/i, "🔥"],
  [/laptop|notebook|ordinateur|computer|لابتوب|حاسب/i, "💻"],
  [/phone|mobile|t[eé]l[eé]phone|جوال|هاتف|موبايل/i, "📱"],
  [/tablet|tablette|تابلت|لوحي/i, "📲"],
  [/audio|headphone|casque|سماع/i, "🎧"],
  [/accessor|إكسسوار|اكسسوار/i, "🔌"],
  [/shoe|sneaker|chaussure|حذاء|أحذية/i, "👟"],
  [/cloth|apparel|v[eê]tement|shirt|ملابس/i, "👕"],
  [/hair|cheveu|coiff|شعر/i, "💇"],
  [/nail|ongle|manucure|أظافر|اظافر/i, "💅"],
  [/massage|مساج/i, "💆"],
  [/facial|visage|skin|peau|بشرة|وجه/i, "🧖"],
  [/beauty|beaut[eé]|makeup|maquillage|تجميل|مكياج/i, "💄"],
  [/package|forfait|bundle|باقة|باقات/i, "🎁"],
  [/member|abonnement|اشتراك|عضوية/i, "🏋️"],
  [/class|cours|حصص|كلاس/i, "🤸"],
  [/train|coach|مدرب|تدريب/i, "💪"],
];

const SERVICE_ICONS: Record<string, string> = {
  salon: "💇",
  spa: "💆",
  clinic: "🩺",
  gym: "🏋️",
  restaurant: "🍽️",
  cafe: "☕\uFE0F",
  engineering: "📐",
  service_business: "🛠️",
};

/** A friendly icon for a category, from its own (any-language) name; null when nothing matches — the UI then shows a monogram instead of guessing. */
export function categoryIcon(name: LocalizedText | null | undefined): string | null {
  if (!name) return null;
  const haystack = Object.values(name).join(" ");
  for (const [pattern, icon] of CATEGORY_ICONS) if (pattern.test(haystack)) return icon;
  return null;
}

export function serviceIcon(businessTypeKey: string): string {
  return SERVICE_ICONS[businessTypeKey] ?? "📅";
}

const TONES = [
  "from-amber-50 to-orange-100",
  "from-emerald-50 to-teal-100",
  "from-sky-50 to-indigo-100",
  "from-rose-50 to-pink-100",
  "from-violet-50 to-fuchsia-100",
  "from-lime-50 to-green-100",
  "from-yellow-50 to-amber-100",
  "from-cyan-50 to-sky-100",
];

/** Stable soft background per seed (category id) — products in one category share a tone. */
export function toneFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TONES[hash % TONES.length];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Catalog products the assistant's reply actually names (any language the
 * product has a name in), in the order they appear — so real product cards
 * with real prices and a real "Add" button can sit under the message. Pure
 * text matching over the catalog already on the page: no extra AI call,
 * no invented products. A product whose match sits inside a longer matched
 * name ("Latte" inside "Spanish Latte") is dropped.
 */
export function findMentionedProducts<T extends { id: string; name: LocalizedText }>(
  reply: string,
  products: T[],
  limit = 6,
): T[] {
  const haystack = reply.toLocaleLowerCase();
  const hits: { product: T; start: number; end: number }[] = [];
  for (const product of products) {
    let best: { start: number; end: number } | null = null;
    for (const raw of Object.values(product.name)) {
      const needle = raw.trim().toLocaleLowerCase();
      if (needle.length < 3) continue;
      let from = 0;
      while (from <= haystack.length) {
        const start = haystack.indexOf(needle, from);
        if (start < 0) break;
        const end = start + needle.length;
        const before = start > 0 ? haystack[start - 1] : "";
        const after = end < haystack.length ? haystack[end] : "";
        if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) {
          if (!best || start < best.start) best = { start, end };
          break;
        }
        from = start + 1;
      }
    }
    if (best) hits.push({ product, ...best });
  }
  return hits
    .filter((hit) => !hits.some((other) => other !== hit && other.start <= hit.start && other.end >= hit.end && other.end - other.start > hit.end - hit.start))
    .sort((a, b) => a.start - b.start)
    .slice(0, limit)
    .map((hit) => hit.product);
}
