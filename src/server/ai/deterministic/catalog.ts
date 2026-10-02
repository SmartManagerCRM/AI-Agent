/**
 * Deterministic catalog retrieval for the customer Agent: menu discovery,
 * product/category search and price questions answered straight from the
 * business's own active catalog — no AI call, no invented products.
 *
 *   "What food do you have?" / "ما هي قائمة الطعام؟" → MENU_DISCOVERY
 *   "شوربة" / "Do you have soup?" / "Show me breakfast" → PRODUCT_SEARCH
 *   "How much is it?" → PRICE (the product last mentioned in this conversation)
 *   "Do you have pizza?" (not on the menu) → NOT_FOUND, never a guess
 *   "Which soup is lightest?" → null: needs reasoning → the AI, with only
 *   the matching products as context (`relevantProducts`).
 *
 * Replies carry the matched product ids so the UI renders real product
 * cards (price, Add, detail) rather than a paragraph. Pure — no I/O.
 */

export type CatalogProduct = {
  id: string;
  /** Name per language, as stored. */
  names: Record<string, string>;
  description: string | null;
  categoryId: string | null;
  priceMinor: number;
};

export type CatalogCategory = { id: string; names: Record<string, string> };

export type Catalog = {
  products: CatalogProduct[];
  categories: CatalogCategory[];
  currency: string;
  currencyExponent: number;
  /** Customer's interface language — the default for product names in replies. */
  locale: string;
};

export type CatalogIntent = "menu" | "search" | "category" | "price" | "not_found" | "menu_empty";

export type CatalogMatch = { rule: `catalog_${CatalogIntent}`; reply: string; productIds: string[]; intent: CatalogIntent; resultCount: number };

type Lang = "en" | "ar" | "fr";

// ── Normalization (same rules as Business Brain product keys) ────────────────
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => (w.length > 4 && w.startsWith("ال") ? w.slice(2) : w))
    .join(" ");
}

export function tokenize(text: string): string[] {
  return normalizeText(text).split(" ").filter(Boolean);
}

/** Light stemming: plural endings only ("soups" → "soup", "شوربات" → "شورب", "شوربه" → "شورب"). */
function stem(token: string): string {
  if (/[؀-ۿ]/.test(token)) {
    if (token.length > 4 && token.endsWith("ات")) return token.slice(0, -2);
    if (token.length > 3 && token.endsWith("ه")) return token.slice(0, -1);
    return token;
  }
  if (token.length > 4 && token.endsWith("ies")) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/**
 * Menus in this region are often named in one language and asked about in
 * another ("breakfast" ↔ "الفطور", "soup" ↔ "شوربة" ↔ "soupe"). A small,
 * fixed menu vocabulary bridges the common words — deterministic, no AI.
 */
const CONCEPTS: string[] = [
  "breakfast فطور افطار فطار",
  "soup شوربه شوربات حساء soupe chorba shorba",
  "salad سلطه سلطات salade",
  "dessert sweets حلويات حلو حلا",
  "drink beverage مشروبات مشروب boisson",
  "juice عصير عصاير عصاير jus",
  "coffee قهوه cafe",
  "tea شاي",
  "grill grilled مشاوي مشويات grillade",
  "chicken دجاج فراخ poulet",
  "meat لحم لحوم viande",
  "fish سمك اسماك poisson",
  "rice رز ارز riz",
  "bread خبز عيش pain",
  "egg بيض oeuf",
  "cheese جبن جبنه fromage",
  "sandwich ساندويتش ساندوتش سندويش سندوتش شطيره",
  "burger برجر برغر",
  "pizza بيتزا",
  "pasta باستا معكرونه pates",
  "appetizer starter مقبلات entree",
  "water ماء مياه eau",
  "milk حليب lait",
  "cake كيك كعكه gateau",
  "cold بارد بارده froid",
  "falafel فلافل",
  "hummus حمص houmous",
  "fattoush فتوش",
  "shawarma شاورما chawarma",
  "kebab كباب",
  "foul فول",
  "shakshuka شكشوكه chakchouka",
  "kunafa kunafeh knafeh كنافه",
  "lentil عدس lentille",
  "tabbouleh تبوله taboule",
  "labneh لبنه",
  "zaatar زعتر",
  "mandi مندي",
  "kabsa كبسه",
];
const CONCEPT_OF = new Map<string, number>();
CONCEPTS.forEach((line, id) => {
  for (const w of normalizeText(line).split(" ")) {
    CONCEPT_OF.set(w, id);
    CONCEPT_OF.set(stem(w), id);
  }
});
const conceptOf = (token: string) => CONCEPT_OF.get(token) ?? CONCEPT_OF.get(stem(token));

function tokenMatches(query: string, candidate: string): boolean {
  const a = stem(query);
  const b = stem(candidate);
  if (a === b) return true;
  const concept = conceptOf(query);
  if (concept !== undefined && concept === conceptOf(candidate)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short) && long.length - short.length <= 2;
}

const words = (list: string) => new Set(list.split(/\s+/).filter(Boolean).map((w) => normalizeText(w)));

const STOP = words(`
  a an the do does did you your yours have has got any some show me i d im want wanna would like to please can could get give is are am it its
  of for with what whats s there we us see list all tell about need looking find search available today one ones this that these those my
  our in on at from and or so just also something anything thing things kind type was were be been will
  ok okay yes no sure great cool fine good nice hmm bye hi hello hey ahlan salam marhaba
  هل في فيه فيها عندكم عندك عندكو لديكم لديك ابغى ابي اريد بدي نبي نحب حاب شنو شنوة شو ايش اش واش ماذا ماذا ما هي هو من عن على الى الي
  لو سمحت ممكن اعطني عطيني وريني ارني اعرض و يا انا انت تقدمون تبيعون يوجد موجود متوفر شي شيء لكم نوع انواع كل ايه اي
  نعم لا تمام اوكي طيب سلام السلام عليكم اهلا مرحبا
  je j veux voudrais vous avez est ce que qu quoi qui des du de la le les un une montrez moi svp il y pour avec et votre vos
  oui non bonjour salut bonsoir
`);

const MENU = words(`
  menu menus food foods eat dishes meals items products catalog catalogue offer offers sell serve
  منيو قائمة قائمه طعام اكل الاكل اكلات وجبات منتجات مأكولات
  carte plats produits nourriture manger
`);

const PRICE = words(`how much price prices cost costs كم سعر السعر بكم بقداش قداش ثمن combien prix coute`);

/** Needs judgement, not lookup — left to the AI (with only the relevant products as context). */
const REASONING = words(`
  recommend recommendation recommendations suggest suggestion best which better prefer healthy light lighter vegetarian vegan spicy allergy
  allergic gluten kids compare difference popular favourite favorite special
  تنصح تنصحني تنصحوني تقترح اقترح افضل احسن نباتي حار خفيف مميز
  conseillez recommandez conseil meilleur leger vegetarien
`);

/** Questions about the business, not the catalog — never answered with "not on the menu". */
const INFO = words(`
  phone number call contact address location where located hours open close closing opening deliver delivery pickup dine table book booking
  reserve reservation appointment quote whatsapp email website instagram parking wifi payment pay card cash refund return policy owner job
  talk speak human agent someone person staff complaint problem issue help support manager late wrong missing cancel
  رقم هاتف تلفون جوال اتصال عنوان موقع وين فين اين ساعات دوام توصيل حجز موعد واتساب ايميل دفع موظف شخص مشكله شكوي مساعده الغاء
  adresse ou horaires livraison reservation telephone parler humain probleme aide annuler
`);

/** Words that make a message clearly a product request, so "not found" is the honest answer. */
const QUERY_CUES = words(`have got sell serve show want looking find عندكم عندك لديكم يوجد موجود متوفر ابغى ابي اريد بدي نبي حاب avez voudrais veux cherche vendez`);

const QUESTION_WORDS = words(`what شنو شنوة شو ايش اش واش ماذا quoi`);

/** Arabic verbs carry attached pronouns ("أضفها", "احذفه"), so they match by prefix. */
const ACTION_PREFIXES = ["اضف", "ضيف", "زيد", "احذف", "امسح", "اطلب", "ادفع", "اشتر"].map((w) => normalizeText(w));
const CART_WORDS = words(`سله للسله بالسله السله`);
const isAction = (toks: string[]) =>
  toks.some((t) => ACTIONS.has(t) || CART_WORDS.has(t) || ACTION_PREFIXES.some((p) => t.startsWith(p)));

/** Cart / order / payment commands ("add it", "checkout", "أضفها للسلة") — the AI's cart tools handle these, never a catalog lookup. */
const ACTIONS = words(`
  add remove delete cart basket checkout buy purchase pay payment place confirm quantity
  اضف اضيف ضيف زيد احذف امسح سله السله اطلب اشتري ادفع الدفع اكد
  ajoute ajouter enleve supprime panier commander acheter payer paiement confirmer
`);

export function detectLang(message: string, fallback: string): Lang {
  if (/[؀-ۿ]/.test(message)) return "ar";
  const toks = new Set(tokenize(message));
  if (["avez", "vous", "quoi", "combien", "carte", "voudrais", "je", "est", "prix", "merci", "bonjour"].some((w) => toks.has(w))) return "fr";
  // A French conversation stays French (same script) unless the message is plainly English.
  if (fallback === "fr") return ["what", "how", "much", "the", "do", "you", "have", "is", "please", "thanks"].some((w) => toks.has(w)) ? "en" : "fr";
  return fallback === "ar" ? (/[a-z]/i.test(message) ? "en" : fallback) : "en";
}

const T: Record<Lang, {
  found: (q: string) => string;
  menu: string;
  items: string;
  menuTail: string;
  price: (name: string, price: string) => string;
  notFound: (q: string) => string;
  weHave: (list: string) => string;
  empty: string;
  more: (n: number) => string;
}> = {
  en: {
    found: (q) => `Here's what I found for “${q}”:`,
    menu: "Here's our menu:",
    items: "Here's what we have:",
    menuTail: "Tell me what you'd like, or tap an item below.",
    price: (n, p) => `${n} is ${p}.`,
    notFound: (q) => `Sorry, I couldn't find “${q}” on our menu.`,
    weHave: (l) => `We have: ${l}.`,
    empty: "Our menu isn't available here yet — please contact the business for details.",
    more: (n) => `…and ${n} more.`,
  },
  ar: {
    found: (q) => `هذا ما وجدته عن «${q}»:`,
    menu: "هذه قائمتنا:",
    items: "هذا ما لدينا:",
    menuTail: "أخبرني بما تريد، أو اختر من الأصناف أدناه.",
    price: (n, p) => `سعر ${n}: ${p}.`,
    notFound: (q) => `عذراً، لم أجد «${q}» في قائمتنا.`,
    weHave: (l) => `لدينا: ${l}.`,
    empty: "قائمتنا غير متوفرة هنا بعد — يرجى التواصل مع النشاط التجاري مباشرة.",
    more: (n) => `…و${n} أصناف أخرى.`,
  },
  fr: {
    found: (q) => `Voici ce que j'ai trouvé pour « ${q} » :`,
    menu: "Voici notre carte :",
    items: "Voici ce que nous proposons :",
    menuTail: "Dites-moi ce qui vous fait envie, ou choisissez ci-dessous.",
    price: (n, p) => `${n} coûte ${p}.`,
    notFound: (q) => `Désolé, je n'ai pas trouvé « ${q} » sur notre carte.`,
    weHave: (l) => `Nous avons : ${l}.`,
    empty: "Notre carte n'est pas encore disponible ici — contactez directement l'établissement.",
    more: (n) => `…et ${n} autres.`,
  },
};

const MAX_LISTED = 8;

const RTL = /[\u0590-\u08FF]/;

/**
 * The product/category name to show in a reply in `lang`. A name in the
 * other script (an Arabic dish name in an English sentence) is wrapped in
 * Unicode isolates so the sentence doesn't render scrambled.
 */
function nameFor(names: Record<string, string>, lang: string, locale: string): string {
  const name = names[lang] ?? names[locale] ?? Object.values(names)[0] ?? "";
  return RTL.test(name) !== (lang === "ar") ? `\u2068${name}\u2069` : name;
}

function money(c: Catalog, minor: number): string {
  return `${(minor / 10 ** c.currencyExponent).toFixed(c.currencyExponent)} ${c.currency}`;
}

type Scored = { product: CatalogProduct; score: number };

/**
 * Products matching the query tokens: every (known) token must match the
 * product's name, its category or its description — name hits rank first.
 * Tokens the catalog has never heard of are ignored when others match
 * ("fresh soup" → soups), so one stray word doesn't hide real results.
 */
export function searchProducts(tokens: string[], c: Catalog, mode: "all" | "any" = "all"): CatalogProduct[] {
  if (tokens.length === 0) return [];
  const categoryTokens = new Map(c.categories.map((cat) => [cat.id, Object.values(cat.names).flatMap(tokenize)]));
  const indexed = c.products.map((p) => ({
    product: p,
    name: Object.values(p.names).flatMap(tokenize),
    category: p.categoryId ? (categoryTokens.get(p.categoryId) ?? []) : [],
    description: p.description ? tokenize(p.description) : [],
  }));
  const hit = (q: string, list: string[]) => list.some((t) => tokenMatches(q, t));
  const known = tokens.filter((q) => indexed.some((i) => hit(q, i.name) || hit(q, i.category) || hit(q, i.description)));
  if (known.length === 0) return [];
  const scored: Scored[] = [];
  for (const i of indexed) {
    let score = 0;
    let matched = 0;
    for (const q of known) {
      const s = hit(q, i.name) ? 3 : hit(q, i.category) ? 2 : hit(q, i.description) ? 1 : 0;
      if (s > 0) matched += 1;
      score += s;
    }
    if (mode === "all" ? matched === known.length : matched > 0) scored.push({ product: i.product, score });
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.product);
}

function matchCategory(tokens: string[], c: Catalog): CatalogCategory | null {
  if (tokens.length === 0) return null;
  let best: { cat: CatalogCategory; size: number } | null = null;
  for (const cat of c.categories) {
    const catTokens = Object.values(cat.names).flatMap(tokenize);
    if (catTokens.length === 0) continue;
    const all = tokens.every((q) => catTokens.some((t) => tokenMatches(q, t)));
    if (all && c.products.some((p) => p.categoryId === cat.id)) {
      if (!best || catTokens.length < best.size) best = { cat, size: catTokens.length };
    }
  }
  return best?.cat ?? null;
}

/**
 * The product the customer means by "it": the most recent message that
 * names exactly one product. A message naming several is ambiguous — then
 * nothing is guessed (the question goes on to the AI with the history).
 */
function lastMentioned(recent: string[], c: Catalog): CatalogProduct | null {
  for (const text of recent) {
    const toks = ` ${tokenize(text).join(" ")} `;
    const named = new Set<CatalogProduct>();
    for (const p of c.products) {
      if (Object.values(p.names).some((n) => {
        const needle = tokenize(n).join(" ");
        return needle.length >= 3 && toks.includes(` ${needle} `);
      })) named.add(p);
    }
    if (named.size === 1) return [...named][0];
    if (named.size > 1) return null;
  }
  return null;
}

export type CatalogContext = {
  /** Recent conversation texts, newest first (for "how much is it?"). */
  recent?: string[];
  /** Approved, readable Brain items not in the catalog — named (information only) when the catalog is empty. */
  infoOfferings?: string[];
};

export function matchCatalog(message: string, c: Catalog, ctx: CatalogContext = {}): CatalogMatch | null {
  const toks = tokenize(message);
  if (toks.length === 0) return null;
  const has = (set: Set<string>) => toks.some((t) => set.has(t));
  if (has(REASONING) || isAction(toks)) return null;

  const lang = detectLang(message, c.locale);
  const t = T[lang];
  const content = toks.filter((w) => !STOP.has(w) && !MENU.has(w) && !PRICE.has(w) && !QUERY_CUES.has(w) && !QUESTION_WORDS.has(w) && w.length > 1);
  const priceAsk = has(PRICE);
  const menuAsk = has(MENU) || (has(QUESTION_WORDS) && has(QUERY_CUES));
  const line = (p: CatalogProduct) => `• ${nameFor(p.names, lang, c.locale)} — ${money(c, p.priceMinor)}`;
  const list = (ps: CatalogProduct[]) =>
    [...ps.slice(0, MAX_LISTED).map(line), ...(ps.length > MAX_LISTED ? [t.more(ps.length - MAX_LISTED)] : [])].join("\n");
  // Quote the customer's own words (as typed), not their normalized search form.
  const shown = (q: string) => {
    const wanted = new Set(content);
    const words = message.split(/\s+/).filter((w) => tokenize(w).some((t) => wanted.has(t)));
    return words.length > 0 ? words.join(" ").replace(/[?？؟!.،,]+$/u, "") : q;
  };

  if (content.length === 0) {
    if (priceAsk) {
      const p = lastMentioned(ctx.recent ?? [], c);
      if (!p) return null;
      return { rule: "catalog_price", intent: "price", reply: t.price(nameFor(p.names, lang, c.locale), money(c, p.priceMinor)), productIds: [p.id], resultCount: 1 };
    }
    if (!menuAsk) return null;
    if (c.products.length === 0) {
      const info = (ctx.infoOfferings ?? []).slice(0, MAX_LISTED);
      const reply = info.length > 0 ? `${t.items}\n${info.map((i) => `• ${i}`).join("\n")}` : t.empty;
      return { rule: "catalog_menu_empty", intent: "menu_empty", reply, productIds: [], resultCount: info.length };
    }
    const used = c.categories
      .map((cat) => ({ cat, items: c.products.filter((p) => p.categoryId === cat.id) }))
      .filter((g) => g.items.length > 0);
    if (used.length >= 2) {
      const lines = used.map((g) => `• ${nameFor(g.cat.names, lang, c.locale)} (${g.items.length})`).join("\n");
      // A couple of items from each category as cards.
      const perCategory = Math.max(1, Math.floor(MAX_LISTED / used.length));
      const ids = used.flatMap((g) => g.items.slice(0, perCategory).map((p) => p.id)).slice(0, MAX_LISTED);
      return { rule: "catalog_menu", intent: "menu", reply: `${t.menu}\n${lines}\n\n${t.menuTail}`, productIds: ids, resultCount: c.products.length };
    }
    return {
      rule: "catalog_menu",
      intent: "menu",
      reply: `${t.items}\n${list(c.products)}`,
      productIds: c.products.slice(0, MAX_LISTED).map((p) => p.id),
      resultCount: c.products.length,
    };
  }

  const category = matchCategory(content, c);
  if (category) {
    const items = c.products.filter((p) => p.categoryId === category.id);
    return {
      rule: "catalog_category",
      intent: "category",
      reply: `${nameFor(category.names, lang, c.locale)}:\n${list(items)}`,
      productIds: items.slice(0, MAX_LISTED).map((p) => p.id),
      resultCount: items.length,
    };
  }

  const results = searchProducts(content, c);
  if (results.length > 0) {
    if (priceAsk && results.length === 1) {
      const p = results[0];
      return { rule: "catalog_price", intent: "price", reply: t.price(nameFor(p.names, lang, c.locale), money(c, p.priceMinor)), productIds: [p.id], resultCount: 1 };
    }
    return {
      rule: "catalog_search",
      intent: "search",
      reply: `${t.found(shown(content.join(" ")))}\n${list(results)}`,
      productIds: results.slice(0, MAX_LISTED).map((p) => p.id),
      resultCount: results.length,
    };
  }

  // Nothing on the menu matches. Only say so when it clearly was a product request.
  if (content.some((w) => INFO.has(w))) return null;
  const explicit =
    ((has(QUERY_CUES) || priceAsk) && content.length <= 2) || (content.length === 1 && toks.length <= 3);
  if (!explicit || c.products.length === 0) return null;
  const categories = c.categories
    .filter((cat) => c.products.some((p) => p.categoryId === cat.id))
    .slice(0, 6)
    .map((cat) => nameFor(cat.names, lang, c.locale));
  const hint = categories.length > 0 ? ` ${t.weHave(categories.join(lang === "ar" ? "، " : ", "))}` : "";
  return { rule: "catalog_not_found", intent: "not_found", reply: `${t.notFound(shown(content.join(" ")))}${hint}`, productIds: [], resultCount: 0 };
}

/** The few products an AI reply may need for this message (never the whole catalog). */
export function relevantProducts(message: string, c: Catalog, limit = 12): CatalogProduct[] {
  const content = tokenize(message).filter((w) => !STOP.has(w) && !MENU.has(w) && !PRICE.has(w) && !REASONING.has(w) && w.length > 1);
  const category = matchCategory(content, c);
  if (category) return c.products.filter((p) => p.categoryId === category.id).slice(0, limit);
  return searchProducts(content, c, "any").slice(0, limit);
}
