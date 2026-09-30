import { createHash } from "node:crypto";

import type { AiPageFacts } from "./ai-extract";
import type { BusinessTypeGuess } from "./business-type";
import type { ExtractedOffering, PageExtraction } from "./extract";
import { GOOGLE_ATTRIBUTION, GOOGLE_FACT_RETENTION_DAYS, type OpeningHours, type PlaceDetails } from "./google-places";
import type { PageTopic } from "./source-router";
import type { ExtractionMethod } from "@/types/database";

/**
 * Normalization: every source's findings become `FactCandidate`s with one
 * shared vocabulary of fact keys, so the same fact from Google and from
 * the website lands on the same `fact_key` — which is what lets
 * `ingest_brain_fact` detect agreement (unchanged) or disagreement
 * (conflict) across sources.
 *
 * Source authority (highest first) is encoded in the confidence scores:
 * owner (100) > structured API, e.g. Google (90) > structured data on the
 * business's own site (85) > deterministic page extraction (70–75) >
 * AI extraction (≤ 60) > AI inference/summaries (≤ 50). Nothing here
 * overrides anything: every candidate is a *pending* proposal, and the
 * owner's approval is what makes one value authoritative.
 */
export const FACTS_VERSION = "facts-v1";

export type FactSource = "google_business" | "website" | "online_menu" | "online_ordering" | "image";

export type FactCandidate = {
  factKey: string;
  entryType: string;
  content: {
    normalized: unknown;
    display: string;
    source_url?: string | null;
    quote?: string | null;
    attribution?: typeof GOOGLE_ATTRIBUTION | null;
    [key: string]: unknown;
  };
  source: FactSource;
  confidence: number;
  method: ExtractionMethod;
  model: string | null;
  /** Critical facts (price, hours/open status, policies, delivery, availability) get cross-source conflict detection and are never auto-trusted. */
  critical: boolean;
  expiresAt: string | null;
};

const DAY_LABEL: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export function describeHours(hours: OpeningHours): string {
  return (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const)
    .map((d) => `${DAY_LABEL[d]} ${hours[d]?.length ? hours[d]!.map((r) => `${r.open}–${r.close}`).join(", ") : "closed"}`)
    .join(" · ");
}

/**
 * Name normalization for matching the same product across sources:
 * case, Latin accents, Arabic letter variants (أ/إ/آ → ا, ة → ه, ى → ي),
 * diacritics, tatweel, the definite article "ال", and punctuation. The
 * original name is always kept for display; only the key is normalized.
 */
export function normalizeProductName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
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

export function offeringKey(name: string): string {
  const normalized = normalizeProductName(name);
  const ascii = normalized
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const hash = createHash("sha1").update(normalized).digest("hex").slice(0, 8);
  return `offering:${ascii ? `${ascii}-` : ""}${hash}`;
}

function shortHash(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function offeringDisplay(o: { name: string; amount: string | null; currency: string | null }): string {
  if (o.amount && o.currency) return `${o.name} — ${o.amount} ${o.currency}`;
  if (o.amount) return `${o.name} — ${o.amount} (currency not stated)`;
  return `${o.name} (price not stated)`;
}

export function expiryFromNow(days: number, now = new Date()): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

// ── Google Places ────────────────────────────────────────────────────────

export function factsFromGoogle(place: PlaceDetails, typeGuess: BusinessTypeGuess | null, now = new Date()): FactCandidate[] {
  const expiresAt = expiryFromNow(GOOGLE_FACT_RETENTION_DAYS, now);
  const base = { source: "google_business" as const, method: "structured_api" as const, model: null, expiresAt, confidence: 90 };
  const content = (normalized: unknown, display: string) => ({
    normalized,
    display,
    source_url: place.mapsUri,
    attribution: GOOGLE_ATTRIBUTION,
  });
  const facts: FactCandidate[] = [];

  if (place.name) facts.push({ ...base, factKey: "identity.name", entryType: "identity", content: content(place.name, place.name), critical: false });
  if (place.businessStatus) {
    facts.push({
      ...base,
      factKey: "identity.operational_status",
      entryType: "identity",
      content: content(place.businessStatus, place.businessStatus.replace(/_/g, " ").toLowerCase()),
      critical: true,
    });
  }
  if (typeGuess) facts.push(typeFact(typeGuess, "google_business", expiresAt, place.mapsUri));
  if (place.formattedAddress) {
    facts.push({ ...base, factKey: "location.address", entryType: "location", content: content(place.formattedAddress, place.formattedAddress), critical: false });
  }
  if (place.location) {
    facts.push({
      ...base,
      factKey: "location.geo",
      entryType: "location",
      content: content(place.location, `${place.location.lat.toFixed(5)}, ${place.location.lng.toFixed(5)}`),
      critical: false,
    });
  }
  const phone = place.phoneInternational?.replace(/[^\d+]/g, "") ?? null;
  if (phone) facts.push({ ...base, factKey: "contact.phone", entryType: "contact", content: content(phone, place.phoneInternational ?? phone), critical: false });
  if (place.website) facts.push({ ...base, factKey: "contact.website", entryType: "contact", content: content(place.website, place.website), critical: false });
  if (place.regularHours) {
    facts.push({ ...base, factKey: "hours.regular", entryType: "hours", content: content(place.regularHours, describeHours(place.regularHours)), critical: true });
  }
  const capabilityKeys: Record<string, string> = {
    delivery: "delivery",
    dineIn: "dine_in",
    takeout: "takeout",
    reservable: "reservations",
    curbsidePickup: "curbside_pickup",
  };
  for (const [key, value] of Object.entries(place.capabilities)) {
    if (typeof value !== "boolean" || !capabilityKeys[key]) continue;
    facts.push({
      ...base,
      confidence: 80, // Google's attribute data is often contributed, not owner-set
      factKey: `capability.${capabilityKeys[key]}`,
      entryType: "capability",
      content: content(value, `${capabilityKeys[key].replace(/_/g, " ")}: ${value ? "yes" : "no"}`),
      critical: true,
    });
  }
  return facts;
}

export function typeFact(guess: BusinessTypeGuess, source: FactSource, expiresAt: string | null, sourceUrl: string | null): FactCandidate {
  return {
    factKey: "business_type",
    entryType: "business_type",
    content: {
      normalized: { key: guess.key, category: guess.category },
      display: guess.label ? `${guess.label} (${guess.key.replace(/_/g, " ")})` : guess.key.replace(/_/g, " "),
      source_url: sourceUrl,
      classifier: { source: guess.source, version: guess.version, evidence: guess.evidence },
    },
    source,
    confidence: guess.confidence,
    method: guess.source === "ai" ? "inferred" : guess.source === "google_types" ? "structured_api" : "structured_data",
    model: null,
    critical: false,
    expiresAt,
  };
}

// ── Website pages ───────────────────────────────────────────────────────

export type WebsitePageInput = { url: string; topic: PageTopic; score: number; extraction: PageExtraction; ai?: AiPageFacts | null };

/**
 * All website facts, de-duplicated *within* the website source: when two
 * pages say the same fact, the most authoritative extraction (then the
 * best-ranked page) wins, so one source never conflicts with itself.
 */
export function factsFromWebsite(pages: WebsitePageInput[]): FactCandidate[] {
  const best = new Map<string, FactCandidate & { rank: number }>();
  const put = (fact: FactCandidate, pageScore: number) => {
    const rank = fact.confidence * 1000 + pageScore;
    const existing = best.get(fact.factKey);
    if (!existing || rank > existing.rank) best.set(fact.factKey, { ...fact, rank });
  };
  const base = { source: "website" as const, expiresAt: null, model: null };

  for (const page of pages) {
    const x = page.extraction;
    const src = { source_url: page.url };
    const home = page.topic === "home";

    if (x.business?.name) {
      put({ ...base, factKey: "identity.name", entryType: "identity", content: { normalized: x.business.name, display: x.business.name, ...src }, confidence: 85, method: "structured_data", critical: false }, page.score);
    }
    const description = x.business?.description ?? (home ? x.description : null);
    if (description) {
      put(
        { ...base, factKey: "identity.about", entryType: "about", content: { normalized: description, display: description, ...src }, confidence: x.business?.description ? 85 : 70, method: x.business?.description ? "structured_data" : "deterministic", critical: false },
        page.score,
      );
    }
    if (x.business?.address) {
      put({ ...base, factKey: "location.address", entryType: "location", content: { normalized: x.business.address, display: x.business.address, ...src }, confidence: 85, method: "structured_data", critical: false }, page.score);
    }
    if (x.business?.hours) {
      put({ ...base, factKey: "hours.regular", entryType: "hours", content: { normalized: x.business.hours, display: describeHours(x.business.hours), ...src }, confidence: 85, method: "structured_data", critical: true }, page.score);
    }
    const phone = x.phones[0];
    if (phone) {
      const structured = x.business?.telephone ? x.business.telephone.replace(/[^\d+]/g, "").endsWith(phone.replace(/^\+/, "").slice(-8)) : false;
      put({ ...base, factKey: "contact.phone", entryType: "contact", content: { normalized: phone, display: phone, ...src }, confidence: structured ? 85 : 75, method: structured ? "structured_data" : "deterministic", critical: false }, page.score);
    }
    if (x.emails[0]) put({ ...base, factKey: "contact.email", entryType: "contact", content: { normalized: x.emails[0], display: x.emails[0], ...src }, confidence: 75, method: "deterministic", critical: false }, page.score);
    if (x.whatsapp[0]) put({ ...base, factKey: "contact.whatsapp", entryType: "contact", content: { normalized: x.whatsapp[0], display: x.whatsapp[0], ...src }, confidence: 75, method: "deterministic", critical: false }, page.score);
    for (const social of x.socials) {
      put({ ...base, factKey: `social.${social.platform}`, entryType: "contact", content: { normalized: social.url, display: social.url, ...src }, confidence: 75, method: "deterministic", critical: false }, page.score);
    }
    for (const offering of x.offerings) put(offeringFact(offering, page.url, offering.method === "structured_data" ? 85 : 70, offering.method, null), page.score);
    for (const faq of x.faqs) {
      put(
        { ...base, factKey: `faq.${shortHash(faq.question.toLowerCase())}`, entryType: "faq", content: { normalized: { question: faq.question, answer: faq.answer }, display: faq.answer, question: faq.question, ...src }, confidence: 75, method: "deterministic", critical: false },
        page.score,
      );
    }

    const ai = page.ai;
    if (!ai) continue;
    const model = ai.model || null;
    if (ai.about) {
      put({ ...base, model, factKey: "identity.about", entryType: "about", content: { normalized: ai.about, display: ai.about, ...src }, confidence: 50, method: "inferred", critical: false }, page.score);
    }
    for (const offering of ai.offerings) {
      put(offeringFact(offering, page.url, offering.amount ? 60 : 50, "ai", model), page.score);
    }
    for (const policy of ai.policies) {
      put(
        { ...base, model, factKey: `policy.${policy.kind}`, entryType: "policy", content: { normalized: { kind: policy.kind, quote: policy.quote }, display: policy.quote, summary: policy.summary, quote: policy.quote, ...src }, confidence: 60, method: "ai", critical: true },
        page.score,
      );
    }
    for (const faq of ai.faqs) {
      put(
        { ...base, model, factKey: `faq.${shortHash(faq.question.toLowerCase())}`, entryType: "faq", content: { normalized: { question: faq.question, answer: faq.answer }, display: faq.answer, question: faq.question, ...src }, confidence: 60, method: "ai", critical: false },
        page.score,
      );
    }
    if (ai.hoursQuote) {
      put({ ...base, model, factKey: "hours.note", entryType: "hours", content: { normalized: ai.hoursQuote, display: ai.hoursQuote, quote: ai.hoursQuote, ...src }, confidence: 55, method: "ai", critical: true }, page.score);
    }
    if (ai.deliveryQuote) {
      put({ ...base, model, factKey: "policy.delivery_terms", entryType: "policy", content: { normalized: ai.deliveryQuote, display: ai.deliveryQuote, quote: ai.deliveryQuote, ...src }, confidence: 55, method: "ai", critical: true }, page.score);
    }
  }
  return [...best.values()].map(({ rank: _rank, ...fact }) => fact);
}

function offeringFact(
  o: Pick<ExtractedOffering, "name" | "amount" | "currency" | "description" | "category" | "kind">,
  url: string,
  confidence: number,
  method: ExtractionMethod,
  model: string | null,
  source: FactSource = "website",
  extra: Record<string, unknown> = {},
): FactCandidate {
  const currency = o.amount ? o.currency : null;
  return {
    factKey: offeringKey(o.name),
    entryType: o.kind === "service" ? "service_candidate" : "product_candidate",
    content: {
      normalized: { name: o.name, amount: o.amount, currency },
      // Only the price is compared across sources: a source that shows the
      // item without a price does not "disagree" with one that shows a price.
      conflict_value: o.amount ? { amount: o.amount, currency } : null,
      display: offeringDisplay(o),
      description: o.description,
      category: o.category,
      source_url: url,
      ...extra,
    },
    source,
    confidence,
    method,
    model,
    critical: true,
    expiresAt: null,
  };
}

// ── Menu / catalog sources ───────────────────────────────────────────────

export type CatalogPageInput = {
  url: string;
  role: "direct" | "related" | "ordering";
  kind: string;
  extraction: Pick<PageExtraction, "offerings"> & Partial<Pick<PageExtraction, "cards">>;
  ai?: AiPageFacts | null;
};

/**
 * Products from menu/catalog pages. Source priority is carried by source
 * type and confidence: a verified online-ordering source (88/82) ranks
 * above the direct menu page (85/80), which ranks above menu images
 * (≤ 78) and ordinary website pages (70); AI-read text stays at 60.
 */
export function factsFromCatalogPages(pages: CatalogPageInput[]): FactCandidate[] {
  const best = new Map<string, FactCandidate>();
  const put = (f: FactCandidate) => {
    const key = `${f.source}|${f.factKey}`;
    const existing = best.get(key);
    if (!existing || f.confidence > existing.confidence || (f.confidence === existing.confidence && !!(f.content.normalized as { amount?: string }).amount && !(existing.content.normalized as { amount?: string }).amount)) {
      best.set(key, f);
    }
  };
  for (const page of pages) {
    const source: FactSource = page.role === "ordering" ? "online_ordering" : "online_menu";
    const trace = { source_kind: page.role === "ordering" ? "ONLINE_ORDERING" : "MENU_PAGE", page_kind: page.kind, source_role: page.role };
    for (const o of page.extraction.offerings) {
      const structured = o.method === "structured_data";
      const confidence = page.role === "ordering" ? (structured ? 88 : 82) : structured ? 85 : 80;
      put(offeringFact(o, page.url, confidence, o.method, null, source, { ...trace, extraction: structured ? "STRUCTURED_DATA" : "HTML" }));
    }
    // Item cards on a menu/catalog page: product names (and descriptions) without prices.
    const priced = new Set(page.extraction.offerings.map((o) => offeringKey(o.name)));
    for (const c of page.extraction.cards ?? []) {
      if (priced.has(offeringKey(c.name))) continue;
      put(
        offeringFact({ name: c.name, amount: null, currency: null, description: c.description, category: c.category, kind: "product" }, page.url, 70, "deterministic", null, source, {
          ...trace,
          extraction: "HTML_CARD",
        }),
      );
    }
    for (const o of page.ai?.offerings ?? []) {
      put(offeringFact(o, page.url, o.amount ? 60 : 50, "ai", page.ai?.model || null, source, { ...trace, extraction: "AI_TEXT" }));
    }
  }
  return [...best.values()];
}

/** Products read from menu images (OCR or vision), with the image they came from. */
export function factsFromMenuImages(
  items: {
    name: string;
    secondaryName: string | null;
    amount: string | null;
    currency: string | null;
    category: string | null;
    description: string | null;
    variants: { name: string; amount: string | null }[];
    modifiers: string[];
    size: string | null;
    ingredients: string[];
    dietary: string[];
    availability: string | null;
    method: "ocr" | "vision";
    model: string | null;
    confidence: number;
    imageUrl: string;
    pageUrl: string;
  }[],
): FactCandidate[] {
  const best = new Map<string, FactCandidate>();
  for (const i of items) {
    const fact = offeringFact(
      { name: i.name, amount: i.amount, currency: i.currency, description: i.description, category: i.category, kind: "product" },
      i.pageUrl,
      i.confidence,
      i.method,
      i.model,
      "image",
      {
        source_kind: "MENU_IMAGE",
        source_image_url: i.imageUrl,
        extraction: i.method === "vision" ? "VISION_OCR" : "OCR",
        secondary_name: i.secondaryName,
        variants: i.variants.length ? i.variants : undefined,
        modifiers: i.modifiers.length ? i.modifiers : undefined,
        size: i.size,
        ingredients: i.ingredients.length ? i.ingredients : undefined,
        dietary: i.dietary.length ? i.dietary : undefined,
        availability: i.availability,
      },
    );
    const existing = best.get(fact.factKey);
    if (!existing || fact.confidence > existing.confidence) best.set(fact.factKey, fact);
  }
  return [...best.values()];
}
