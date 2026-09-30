import { createHash } from "node:crypto";

import * as cheerio from "cheerio";

import type { OpeningHours, WeekdayKey } from "./google-places";
import { extractPageMedia, type ExtractedImage, type PageMedia } from "./page-media";

/**
 * Deterministic website extraction — the "CODE FOR EXTRACTION" half of the
 * engine. Everything here is read straight out of the markup: schema.org
 * JSON-LD, tel:/mailto: links, social links, and priced lines in lists and
 * tables. Nothing is guessed: a price is only taken when a currency is
 * written next to it, and a line without one is left for review (or for
 * the gated AI step), never given a default currency.
 *
 * cheerio parses markup without executing scripts, so page content is
 * only ever data here.
 */
export const EXTRACTOR_VERSION = "extract-v2";

export type ExtractedOffering = {
  name: string;
  /** Decimal string in the currency's own precision ("18.00", "1.250"), or null when no price was stated. */
  amount: string | null;
  currency: string | null;
  description: string | null;
  category: string | null;
  kind: "product" | "service";
  method: "structured_data" | "deterministic";
};

export type ExtractedBusinessSchema = {
  types: string[];
  name: string | null;
  description: string | null;
  telephone: string | null;
  email: string | null;
  address: string | null;
  geo: { lat: number; lng: number } | null;
  hours: OpeningHours | null;
  priceRange: string | null;
};

export type PageExtraction = {
  version: string;
  title: string | null;
  description: string | null;
  lang: string | null;
  canonical: string | null;
  links: { url: string; text: string }[];
  /** Readable text (scripts/styles/nav chrome removed), capped — the input to fingerprinting and the AI step. */
  text: string;
  phones: string[];
  emails: string[];
  whatsapp: string[];
  socials: { platform: string; url: string }[];
  business: ExtractedBusinessSchema | null;
  offerings: ExtractedOffering[];
  faqs: { question: string; answer: string }[];
  /** Section headings (menu categories on catalog pages). */
  headings: string[];
  /** Item cards (names/descriptions without prices) — used as products only on menu/catalog pages. */
  cards: PageMedia["cards"];
  og: PageMedia["og"];
  /** Every image on the page — the input to menu-image triage (a menu is often only images). */
  images: ExtractedImage[];
  /** schema.org @type values present on the page (Menu, Product, Restaurant, ...). */
  schemaTypes: string[];
};

const MAX_TEXT = 40_000;
const MAX_OFFERINGS = 300;

/** SHA-256 of what the page *says* (text + structured data), not its markup — cosmetic HTML changes don't count as changes. */
export function contentFingerprint(extraction: Pick<PageExtraction, "text" | "business" | "offerings" | "faqs"> & { images?: { key: string }[] }): string {
  return createHash("sha256")
    .update(extraction.text)
    .update("\u0000")
    .update(JSON.stringify([extraction.business, extraction.offerings, extraction.faqs, (extraction.images ?? []).map((i) => i.key)]))
    .digest("hex");
}

export function extractFromHtml(html: string, pageUrl: string): PageExtraction {
  const $ = cheerio.load(html);
  const base = safeUrl(pageUrl);

  const jsonLd = collectJsonLd($);
  const title = clean($("title").first().text()) || null;
  const description =
    clean($('meta[name="description"]').attr("content") ?? "") || clean($('meta[property="og:description"]').attr("content") ?? "") || null;
  const lang = clean($("html").attr("lang") ?? "") || null;
  const canonicalHref = $('link[rel="canonical"]').attr("href");
  const canonical = canonicalHref && base ? (safeUrl(canonicalHref, base)?.toString() ?? null) : null;

  const links: { url: string; text: string }[] = [];
  const phones = new Set<string>();
  const emails = new Set<string>();
  const whatsapp = new Set<string>();
  const socials = new Map<string, string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (/^tel:/i.test(href)) {
      const phone = normalizePhone(decodeSafe(href.slice(4)));
      if (phone) phones.add(phone);
      return;
    }
    if (/^mailto:/i.test(href)) {
      const email = decodeSafe(href.slice(7).split("?")[0]).trim().toLowerCase();
      if (EMAIL.test(email)) emails.add(email);
      return;
    }
    if (!base) return;
    const url = safeUrl(href, base);
    if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return;
    url.hash = "";
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "wa.me" || host === "api.whatsapp.com") {
      const digits = (host === "wa.me" ? url.pathname.slice(1) : (url.searchParams.get("phone") ?? "")).replace(/\D/g, "");
      if (digits.length >= 8 && digits.length <= 15) whatsapp.add(`+${digits}`);
      return;
    }
    const platform = SOCIAL_HOSTS[host];
    if (platform) {
      if (url.pathname.length > 1 && !socials.has(platform) && !/\/(share|sharer|intent|plugins)/.test(url.pathname)) {
        socials.set(platform, url.toString());
      }
      return;
    }
    links.push({ url: url.toString(), text: clean($(el).text()).slice(0, 80) });
  });

  // Offerings and FAQs from structured data first — the most reliable source on a page.
  const offerings: ExtractedOffering[] = [];
  const faqs: { question: string; answer: string }[] = [];
  let business: ExtractedBusinessSchema | null = null;
  for (const node of flattenJsonLd(jsonLd)) {
    const types = typeList(node);
    if (types.some((t) => t === "FAQPage")) faqs.push(...faqsFromSchema(node));
    if (types.some((t) => t === "Menu" || t === "MenuSection")) offerings.push(...offeringsFromMenu(node, null));
    if (types.some((t) => t === "MenuItem" || t === "Product" || t === "Service" || t === "Offer")) {
      const item = offeringFromSchema(node, null);
      if (item) offerings.push(item);
    }
    if (!business && isLocalBusiness(node)) business = businessFromSchema(node);
  }
  if (business) {
    const b = business as ExtractedBusinessSchema;
    if (b.telephone) {
      const p = normalizePhone(b.telephone);
      if (p) phones.add(p);
    }
    if (b.email && EMAIL.test(b.email.toLowerCase())) emails.add(b.email.toLowerCase());
  }

  // Images, headings, OpenGraph and embedded catalog JSON — read before scripts are removed.
  const media = extractPageMedia($, base);
  if (offerings.length === 0) offerings.push(...media.embeddedOfferings);

  // Visible text — without scripts and page chrome.
  $("script, style, noscript, template, svg, iframe").remove();
  const detailsFaqs = faqsFromDetails($);
  $("header nav, footer nav, [role=navigation], .cookie, #cookie, [class*=cookie-banner]").remove();
  const text = clean($("body").text()).slice(0, MAX_TEXT);

  // Priced lines in lists/tables (only when structured data had none — avoids double counting).
  if (offerings.length === 0) offerings.push(...offeringsFromMarkup($));

  // Phones written as text (only well-formed international or local-with-prefix numbers).
  for (const match of text.matchAll(PHONE_IN_TEXT)) {
    const p = normalizePhone(match[0]);
    if (p) phones.add(p);
    if (phones.size >= 5) break;
  }
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    emails.add(match[0].toLowerCase());
    if (emails.size >= 5) break;
  }

  return {
    version: EXTRACTOR_VERSION,
    title,
    description,
    lang,
    canonical,
    links: dedupeLinks(links),
    text,
    phones: [...phones].slice(0, 5),
    emails: [...emails].slice(0, 5),
    whatsapp: [...whatsapp].slice(0, 3),
    socials: [...socials.entries()].map(([platform, url]) => ({ platform, url })),
    business,
    offerings: dedupeOfferings(offerings).slice(0, MAX_OFFERINGS),
    faqs: [...faqs, ...detailsFaqs].slice(0, 50),
    headings: media.headings,
    cards: media.cards,
    og: media.og,
    images: media.images,
    schemaTypes: [...new Set(flattenJsonLd(jsonLd).flatMap(typeList))].slice(0, 30),
  };
}

// ── JSON-LD ─────────────────────────────────────────────────────────────

type Node = Record<string, unknown>;

function collectJsonLd($: cheerio.CheerioAPI): Node[] {
  const out: Node[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const parsed: unknown = JSON.parse($(el).contents().text());
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) if (isNode(item)) out.push(item);
    } catch {
      // malformed JSON-LD on the page — skip it
    }
  });
  return out;
}

function flattenJsonLd(nodes: Node[]): Node[] {
  const out: Node[] = [];
  const visit = (node: Node, depth: number) => {
    if (depth > 3 || out.length > 500) return;
    out.push(node);
    const graph = node["@graph"];
    if (Array.isArray(graph)) for (const g of graph) if (isNode(g)) visit(g, depth + 1);
  };
  for (const n of nodes) visit(n, 0);
  return out;
}

const LOCAL_BUSINESS_HINTS = /(LocalBusiness|Restaurant|CafeOrCoffeeShop|FoodEstablishment|Store|Salon|Spa|Clinic|Dentist|Physician|HealthClub|ExerciseGym|Hotel|LodgingBusiness|ProfessionalService|AutoRepair|Bakery|BarOrPub|MedicalBusiness|HomeAndConstructionBusiness|LegalService|Organization)$/;

function isLocalBusiness(node: Node): boolean {
  return typeList(node).some((t) => LOCAL_BUSINESS_HINTS.test(t)) && (Boolean(node.address) || Boolean(node.telephone) || Boolean(node.openingHoursSpecification) || Boolean(node.openingHours));
}

function businessFromSchema(node: Node): ExtractedBusinessSchema {
  const geo = isNode(node.geo) ? node.geo : null;
  const lat = geo ? Number(geo.latitude) : NaN;
  const lng = geo ? Number(geo.longitude) : NaN;
  return {
    types: typeList(node),
    name: str(node.name),
    description: str(node.description),
    telephone: str(node.telephone),
    email: str(node.email)?.replace(/^mailto:/i, "") ?? null,
    address: addressText(node.address),
    geo: Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null,
    hours: hoursFromSchema(node),
    priceRange: str(node.priceRange),
  };
}

function addressText(address: unknown): string | null {
  if (typeof address === "string") return clean(address) || null;
  if (!isNode(address)) return null;
  const parts = ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]
    .map((k) => (isNode(address[k]) ? str((address[k] as Node).name) : str(address[k])))
    .filter((p): p is string => Boolean(p));
  return parts.length > 0 ? parts.join(", ") : null;
}

const SCHEMA_DAYS: Record<string, WeekdayKey> = {
  monday: "mon",
  tuesday: "tue",
  wednesday: "wed",
  thursday: "thu",
  friday: "fri",
  saturday: "sat",
  sunday: "sun",
  mo: "mon",
  tu: "tue",
  we: "wed",
  th: "thu",
  fr: "fri",
  sa: "sat",
  su: "sun",
};
const DAY_ORDER: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function hoursFromSchema(node: Node): OpeningHours | null {
  const hours: OpeningHours = {};
  const add = (day: WeekdayKey, open: string, close: string) => {
    const o = hhmm(open);
    const c = hhmm(close);
    if (!o || !c) return;
    const list = (hours[day] ??= []);
    if (!list.some((r) => r.open === o && r.close === (c === "00:00" ? "24:00" : c))) list.push({ open: o, close: c === "00:00" ? "24:00" : c });
  };

  const specs = node.openingHoursSpecification;
  for (const spec of Array.isArray(specs) ? specs : specs ? [specs] : []) {
    if (!isNode(spec)) continue;
    const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
    for (const d of days) {
      const key = typeof d === "string" ? SCHEMA_DAYS[d.replace(/^https?:\/\/schema\.org\//i, "").toLowerCase()] : undefined;
      if (key && typeof spec.opens === "string" && typeof spec.closes === "string") add(key, spec.opens, spec.closes);
    }
  }

  // "Mo-Fr 09:00-17:00", "Sa 10:00-14:00"
  const strings = node.openingHours;
  for (const line of Array.isArray(strings) ? strings : typeof strings === "string" ? [strings] : []) {
    if (typeof line !== "string") continue;
    const m = /^\s*([A-Za-z]{2})(?:\s*-\s*([A-Za-z]{2}))?(?:\s*,\s*[A-Za-z]{2})*\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(line);
    if (!m) continue;
    const from = SCHEMA_DAYS[m[1].toLowerCase()];
    const to = m[2] ? SCHEMA_DAYS[m[2].toLowerCase()] : from;
    if (!from || !to) continue;
    const start = DAY_ORDER.indexOf(from);
    const end = DAY_ORDER.indexOf(to);
    for (let i = start; ; i = (i + 1) % 7) {
      add(DAY_ORDER[i], m[3], m[4]);
      if (i === end) break;
    }
  }

  for (const key of Object.keys(hours) as WeekdayKey[]) hours[key]!.sort((a, b) => a.open.localeCompare(b.open));
  return Object.keys(hours).length > 0 ? hours : null;
}

function hhmm(value: string): string | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function faqsFromSchema(node: Node): { question: string; answer: string }[] {
  const entities = Array.isArray(node.mainEntity) ? node.mainEntity : node.mainEntity ? [node.mainEntity] : [];
  const out: { question: string; answer: string }[] = [];
  for (const q of entities) {
    if (!isNode(q)) continue;
    const answer = isNode(q.acceptedAnswer) ? str(q.acceptedAnswer.text) : null;
    const question = str(q.name);
    if (question && answer) out.push({ question: stripTags(question), answer: stripTags(answer).slice(0, 1500) });
  }
  return out;
}

function offeringsFromMenu(node: Node, category: string | null): ExtractedOffering[] {
  const out: ExtractedOffering[] = [];
  const sectionName = typeList(node).includes("MenuSection") ? str(node.name) : category;
  for (const key of ["hasMenuSection", "hasMenuItem"]) {
    const children = node[key];
    for (const child of Array.isArray(children) ? children : children ? [children] : []) {
      if (!isNode(child)) continue;
      if (typeList(child).includes("MenuSection")) out.push(...offeringsFromMenu(child, str(child.name) ?? sectionName));
      else {
        const item = offeringFromSchema(child, sectionName);
        if (item) out.push(item);
      }
    }
  }
  return out;
}

function offeringFromSchema(node: Node, category: string | null): ExtractedOffering | null {
  const name = str(node.name);
  if (!name) return null;
  const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
  const offer = isNode(offers) ? offers : typeList(node).includes("Offer") ? node : null;
  let amount: string | null = null;
  let currency: string | null = null;
  if (offer) {
    const priceSpec = isNode(offer.priceSpecification) ? offer.priceSpecification : null;
    const rawPrice = offer.price ?? offer.lowPrice ?? priceSpec?.price;
    const rawCurrency = str(offer.priceCurrency) ?? str(priceSpec?.priceCurrency);
    currency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency.toUpperCase()) ? rawCurrency.toUpperCase() : null;
    const parsed = rawPrice !== undefined && rawPrice !== null ? parseAmount(String(rawPrice)) : null;
    // No currency written → no price claimed (never assume one).
    amount = parsed !== null && currency ? formatAmount(parsed, currency) : null;
  }
  return {
    name: stripTags(name).slice(0, 120),
    amount,
    currency: amount ? currency : null,
    description: str(node.description) ? stripTags(str(node.description)!).slice(0, 300) : null,
    category,
    kind: typeList(node).includes("Service") ? "service" : "product",
    method: "structured_data",
  };
}

// ── Markup (lists / tables / item cards) ─────────────────────────────────

/** Currency tokens as written on Gulf/MENA/European sites → ISO code. Longest/most specific first. */
const CURRENCY_TOKENS: [RegExp, string][] = [
  // Qualified riyals/dinars/dirhams before the bare words, so "ريال قطري" is never read as SAR.
  [/(?:QAR|QR|ر\.\s?ق\.?|ريال\s?قطري)/i, "QAR"],
  [/(?:OMR|RO|ر\.\s?ع\.?|ريال\s?عماني)/i, "OMR"],
  [/(?:KWD|KD|د\.\s?ك\.?|دينار\s?كويتي)/i, "KWD"],
  [/(?:BHD|BD|د\.\s?ب\.?|دينار\s?بحريني)/i, "BHD"],
  [/(?:JOD|JD|د\.\s?أ\.?|دينار\s?أردني)/i, "JOD"],
  [/(?:MAD|د\.\s?م\.?|درهم\s?مغربي)/i, "MAD"],
  [/(?:EGP|ج\.\s?م\.?|جنيه(?:\s?مصري)?)/i, "EGP"],
  [/(?:AED|د\.\s?إ\.?|درهم(?:\s?إماراتي)?)/i, "AED"],
  [/(?:SAR|SR|ر\.\s?س\.?|ريال(?:\s?سعودي)?|﷼)/i, "SAR"],
  [/(?:TRY|₺)/i, "TRY"],
  [/(?:EUR|€)/i, "EUR"],
  [/(?:GBP|£)/i, "GBP"],
  [/(?:USD|US\$|\$)/i, "USD"],
];
export const CURRENCY_EXPONENT: Record<string, number> = { KWD: 3, BHD: 3, OMR: 3, JOD: 3 };

const NUMBER = String.raw`(\d{1,3}(?:[,\u066C]\d{3})+|\d+)(?:[.\u066B](\d{1,3}))?`;
const TOKEN_SOURCE = CURRENCY_TOKENS.map(([re]) => re.source).join("|");
const PRICE_RE = new RegExp(
  String.raw`(?<![\p{L}\d])(?:(${TOKEN_SOURCE})\s?${NUMBER}|${NUMBER}\s?(${TOKEN_SOURCE}))(?![\p{L}\d])`,
  "giu",
);

export type FoundPrice = { amount: string; currency: string; index: number; length: number };

/** Every "18 SAR" / "SAR 18.50" / "١٨ ر.س" / "€12" in a string. */
export function findPrices(input: string): FoundPrice[] {
  const text = toWesternDigits(input);
  const out: FoundPrice[] = [];
  for (const m of text.matchAll(PRICE_RE)) {
    const token = m[1] ?? m[6];
    const intPart = m[2] ?? m[4];
    const frac = m[3] ?? m[5];
    if (!token || !intPart) continue;
    const currency = currencyForToken(token);
    if (!currency) continue;
    const value = Number(`${intPart.replace(/[,\u066C]/g, "")}.${frac ?? "0"}`);
    if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) continue;
    out.push({ amount: formatAmount(value, currency), currency, index: m.index ?? 0, length: m[0].length });
  }
  return out;
}

function currencyForToken(token: string): string | null {
  for (const [re, code] of CURRENCY_TOKENS) if (new RegExp(`^(?:${re.source})$`, "iu").test(token.trim())) return code;
  return null;
}

function offeringsFromMarkup($: cheerio.CheerioAPI): ExtractedOffering[] {
  const selector = "li, tr, dt, [class*=item], [class*=product], [class*=menu], [class*=service], [class*=card], [class*=dish]";
  type Hit = { el: unknown; name: string; price: FoundPrice; heading: string | null };
  const hits: Hit[] = [];
  const qualified = new Set<unknown>();
  $(selector).each((_, el) => {
    const text = clean($(el).text());
    if (text.length < 3 || text.length > 220) return;
    const prices = findPrices(text);
    if (prices.length !== 1) return;
    const price = prices[0];
    const name = cleanName(toWesternDigits(text).slice(0, price.index) + " " + toWesternDigits(text).slice(price.index + price.length));
    if (!name) return;
    qualified.add(el);
    const heading = clean($(el).closest("section, div, table, ul").prevAll("h1, h2, h3, h4").first().text()) || null;
    hits.push({ el, name, price, heading });
  });
  // Keep the innermost element for each priced line (a card and its row both match).
  return hits
    .filter((hit) => !$(hit.el as never).find("*").toArray().some((child) => qualified.has(child)))
    .map((hit) => ({
      name: hit.name,
      amount: hit.price.amount,
      currency: hit.price.currency,
      description: null,
      category: hit.heading && hit.heading.length <= 60 ? hit.heading : null,
      kind: "product" as const,
      method: "deterministic" as const,
    }));
}

export function cleanName(raw: string): string | null {
  const name = raw
    .replace(/[.…·_\-–—:|•]{2,}/g, " ")
    .replace(/^[\s\-–—:|•*]+|[\s\-–—:|•*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name.length < 2 || name.length > 90) return null;
  if (!/[\p{L}]{2,}/u.test(name)) return null;
  if (/^(total|subtotal|vat|tax|delivery fee|shipping|الإجمالي|المجموع|الضريبة)$/i.test(name)) return null;
  return name;
}

function faqsFromDetails($: cheerio.CheerioAPI): { question: string; answer: string }[] {
  const out: { question: string; answer: string }[] = [];
  $("details").each((_, el) => {
    const question = clean($(el).find("summary").first().text());
    const answer = clean($(el).clone().find("summary").remove().end().text());
    if (question.length >= 5 && question.length <= 200 && answer.length >= 2) out.push({ question, answer: answer.slice(0, 1500) });
  });
  return out.slice(0, 30);
}

// ── Helpers ─────────────────────────────────────────────────────────────

const SOCIAL_HOSTS: Record<string, string> = {
  "instagram.com": "instagram",
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "snapchat.com": "snapchat",
  "youtube.com": "youtube",
  "linkedin.com": "linkedin",
};

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const PHONE_IN_TEXT = /(?:\+|00)\d[\d\s().-]{7,16}\d/g;

/** Canonical phone form: "+9665…" for international input, digits (with leading 0) otherwise. Null when implausible. */
export function normalizePhone(raw: string): string | null {
  const western = toWesternDigits(raw).trim();
  const international = /^(\+|00)/.test(western);
  const digits = western.replace(/\D/g, "").replace(/^00/, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return international ? `+${digits}` : digits;
}

export function toWesternDigits(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function parseAmount(raw: string): number | null {
  const text = toWesternDigits(raw).replace(/[,\u066C\s]/g, "").replace("\u066B", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function formatAmount(value: number, currency: string): string {
  return value.toFixed(CURRENCY_EXPONENT[currency] ?? 2);
}

function dedupeOfferings(items: ExtractedOffering[]): ExtractedOffering[] {
  const seen = new Map<string, ExtractedOffering>();
  for (const item of items) {
    const key = `${item.name.toLowerCase()}|${item.amount ?? ""}|${item.currency ?? ""}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()];
}

function dedupeLinks(links: { url: string; text: string }[]): { url: string; text: string }[] {
  const byUrl = new Map<string, string>();
  for (const l of links) if (!byUrl.has(l.url) || (!byUrl.get(l.url) && l.text)) byUrl.set(l.url, l.text);
  return [...byUrl.entries()].slice(0, 400).map(([url, text]) => ({ url, text }));
}

function typeList(node: Node): string[] {
  const t = node["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string");
}

function isNode(value: unknown): value is Node {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripTags(text: string): string {
  return clean(text.replace(/<[^>]*>/g, " "));
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}
