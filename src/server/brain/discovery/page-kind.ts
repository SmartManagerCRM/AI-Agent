import type { PageExtraction } from "./extract";

/**
 * What kind of source a page is — decided before extraction strategy is
 * chosen. A MENU / PRODUCT_CATALOG / SERVICE_CATALOG / ONLINE_ORDERING
 * page gets the catalog pipeline (images included), whatever else the
 * page looks like. Deterministic: URL, link text, headings, title,
 * structured data, price density and image density. Pure.
 */
export type PageKind = "MENU" | "PRODUCT_CATALOG" | "SERVICE_CATALOG" | "ONLINE_ORDERING" | "BUSINESS_INFORMATION" | "UNKNOWN";

export const CATALOG_KINDS: ReadonlySet<PageKind> = new Set(["MENU", "PRODUCT_CATALOG", "SERVICE_CATALOG", "ONLINE_ORDERING"]);

const SIGNALS: Record<Exclude<PageKind, "BUSINESS_INFORMATION" | "UNKNOWN">, RegExp> = {
  MENU: /\b(menus?|carte|breakfast|brunch|lunch|dinner|supper|drinks?|beverages?|desserts?|coffee|food|dishes|mains|starters|appetizers|petit[-\s]?d[ée]jeuner|d[ée]jeuner|d[îi]ner|boissons)\b|قائمة|القائمة|المنيو|منيو|فطور|الفطور|إفطار|الإفطار|غداء|الغداء|عشاء|العشاء|المشروبات|مشروبات|الحلويات|حلويات|أطباق|الأطباق|الأكل/i,
  PRODUCT_CATALOG: /\b(products?|shop|store|catalog(ue)?|collections?|boutique|produits|items|shop-all)\b|منتجات|المنتجات|المتجر|متجر|الكتالوج|كتالوج/i,
  SERVICE_CATALOG: /\b(services?|treatments?|packages?|pricing|price-list|prices|tarifs?|prestations|soins|classes|memberships?)\b|خدمات|الخدمات|باقات|الباقات|الأسعار|اسعار|أسعار|علاجات/i,
  ONLINE_ORDERING: /\b(order(-|\s)?(now|online)?|ordering|delivery|pickup|takeaway|checkout|cart|commander|commande|livraison|[àa]\s?emporter)\b|اطلب|اطلب الآن|الطلب|توصيل|التوصيل|استلام/i,
};

const INFO_SIGNAL = /\b(about|contact|location|find-us|faq|terms|privacy|careers|blog|news|gallery|team)\b|من نحن|اتصل|تواصل|موقعنا/i;

export type PageKindResult = { kind: PageKind; score: number; signals: string[] };

function tokens(url: URL): string {
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // raw
  }
  return path.toLowerCase().replace(/[/_.]+/g, " ");
}

/** From the URL (and link text) alone — used before a page is fetched. */
export function kindFromUrl(url: URL, linkText = ""): PageKindResult {
  const hay = [tokens(url), linkText.toLowerCase()];
  const hits: [PageKind, number, string][] = [];
  for (const [kind, re] of Object.entries(SIGNALS) as [PageKind, RegExp][]) {
    if (re.test(hay[0])) hits.push([kind, 3, `url:${kind}`]);
    else if (hay[1] && re.test(hay[1])) hits.push([kind, 2, `link:${kind}`]);
  }
  if (hits.length === 0) {
    if (url.pathname === "/" || url.pathname === "") return { kind: "BUSINESS_INFORMATION", score: 1, signals: ["home"] };
    return INFO_SIGNAL.test(hay[0]) || INFO_SIGNAL.test(hay[1]) ? { kind: "BUSINESS_INFORMATION", score: 1, signals: ["info"] } : { kind: "UNKNOWN", score: 0, signals: [] };
  }
  hits.sort((a, b) => b[1] - a[1] || priority(a[0]) - priority(b[0]));
  return { kind: hits[0][0], score: hits[0][1], signals: hits.map((h) => h[2]) };
}

// Menus before ordering: "/order-menu" is a menu page with an order button.
function priority(kind: PageKind): number {
  return ["MENU", "PRODUCT_CATALOG", "SERVICE_CATALOG", "ONLINE_ORDERING"].indexOf(kind);
}

/**
 * From the fetched page. `declared` is what the owner said the link is
 * (a menu link is a menu, even when its URL is `/p/123`).
 */
export function classifyPage(
  url: URL,
  x: Pick<PageExtraction, "title" | "headings" | "offerings" | "images" | "text" | "schemaTypes">,
  options: { linkText?: string; declared?: PageKind | null } = {},
): PageKindResult {
  const scores = new Map<PageKind, number>();
  const signals: string[] = [];
  const bump = (kind: PageKind, n: number, why: string) => {
    scores.set(kind, (scores.get(kind) ?? 0) + n);
    signals.push(why);
  };

  if (options.declared && CATALOG_KINDS.has(options.declared)) bump(options.declared, 10, "declared-by-owner");
  const fromUrl = kindFromUrl(url, options.linkText);
  if (CATALOG_KINDS.has(fromUrl.kind)) bump(fromUrl.kind, fromUrl.score, `url:${fromUrl.kind}`);

  const heads = [x.title ?? "", ...(x.headings ?? []).slice(0, 12)].join(" ").toLowerCase();
  for (const [kind, re] of Object.entries(SIGNALS) as [PageKind, RegExp][]) if (re.test(heads)) bump(kind, 2, `heading:${kind}`);

  for (const t of x.schemaTypes ?? []) {
    if (/^(Menu|MenuSection|MenuItem)$/.test(t)) bump("MENU", 4, "schema:Menu");
    if (/^(Product|OfferCatalog|ItemList)$/.test(t)) bump("PRODUCT_CATALOG", 3, "schema:Product");
    if (/^Service$/.test(t)) bump("SERVICE_CATALOG", 3, "schema:Service");
  }

  const priced = x.offerings.filter((o) => o.amount).length;
  if (priced >= 5) {
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "PRODUCT_CATALOG";
    bump(best, 3, `prices:${priced}`);
  }
  // Many large content images and little text: an image-based catalog.
  const contentImages = x.images.filter((i) => !i.inChrome && (i.width ?? 1000) >= 300).length;
  if (contentImages >= 3 && x.text.length < 3000 && scores.size > 0) {
    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0][0];
    bump(best, 1, `images:${contentImages}`);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || priority(a[0]) - priority(b[0]));
  if (ranked.length === 0 || ranked[0][1] < 2) {
    return { kind: fromUrl.kind === "UNKNOWN" && x.text.length > 0 ? "BUSINESS_INFORMATION" : fromUrl.kind, score: 0, signals };
  }
  return { kind: ranked[0][0], score: ranked[0][1], signals };
}

/** Links that point at an online-ordering flow ("ORDER NOW", "اطلب الآن", "Commander"). */
export function isOrderingLink(url: URL, text: string): boolean {
  return SIGNALS.ONLINE_ORDERING.test(text.toLowerCase()) || /(^|\.)(order|orders|ordering|menu)\./i.test(url.hostname) || /\/(order|ordering|online-order)(\/|$)/i.test(url.pathname);
}
