import * as cheerio from "cheerio";

import { extractFromHtml, toWesternDigits } from "@/server/brain/discovery/extract";
import { normalizeProductName } from "@/server/brain/discovery/facts";
import { parseMenuText } from "@/server/brain/discovery/menu-text";
import { isReadableName } from "@/server/brain/discovery/name-quality";
import { parseAmount } from "@/server/agent-public/launch";

/**
 * Catalog file import — the extraction half, pure and AI-free.
 *
 * A subscriber's own price list (HTML page or text PDF) is read with the
 * same deterministic parsers the Business Brain uses: schema.org menus and
 * priced lists/tables on HTML pages, then line-by-line menu parsing
 * ("Spanish Latte ...... 18", "Haircut - 30 min - SAR 40"). No model is
 * ever called, so an import costs nothing in AI.
 *
 * Prices without a written currency are taken to be in the business's own
 * currency (it is the business's own list); a price written in another
 * currency is never converted — that item is reported, not imported.
 */

export type RawCatalogItem = {
  name: string;
  amount: string | null;
  currency: string | null;
  category: string | null;
  description: string | null;
};

export type CatalogItem = {
  name: string;
  priceMajor: number | null;
  category: string | null;
  description: string | null;
  durationMinutes: number | null;
  /**
   * Products only: the price as listed, when it is in another currency. The
   * product is added as a draft with no price of its own — the owner sets it
   * before it can go on sale. Never converted or guessed.
   */
  sourcePrice?: { amount: string | null; currency: string | null } | null;
};

export type PrepareResult = {
  items: CatalogItem[];
  /** Items added that still need the owner's price (listed in another currency). */
  needsPrice: number;
  skipped: { unpriced: number; duplicates: number; unreadable: number };
};

const BLOCKS = "p, li, tr, h1, h2, h3, h4, h5, h6, dt, dd, div, section, article, td, th, br, caption, figcaption";

/** Visible text of an HTML document, one line per block. */
export function htmlToLines(html: string): string[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, template, svg, iframe, head").remove();
  $("br").replaceWith("\n");
  // Table rows read as one line ("Latte | 18"); other blocks end a line.
  $("td, th").each((_, el) => {
    $(el).append(" | ");
  });
  $(BLOCKS).each((_, el) => {
    if (el.type === "tag" && el.name !== "td" && el.name !== "th") $(el).append("\n");
  });
  return $.root()
    .text()
    .split("\n")
    .map((l) =>
      l
        .replace(/\s*\|\s*$/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/** Items in an HTML price list: structured data / priced markup first, then the page's lines. */
export function extractItemsFromHtml(html: string): RawCatalogItem[] {
  const page = extractFromHtml(html, "https://import.invalid/");
  const fromMarkup: RawCatalogItem[] = page.offerings.map((o) => ({
    name: o.name,
    amount: o.amount,
    currency: o.currency,
    category: o.category,
    description: o.description,
  }));
  return mergeItems(fromMarkup, extractItemsFromLines(htmlToLines(html)));
}

/** Items in plain text (a PDF's text, line by line). */
export function extractItemsFromLines(lines: string[]): RawCatalogItem[] {
  const parsed = parseMenuText(lines);
  return parsed.items.map((i) => ({
    name: i.name,
    amount: i.amount,
    currency: i.currency,
    category: i.category,
    description: null,
  }));
}

/** A PDF's text, line by line (text PDFs only — a scanned image has none). Null when it has too many pages. */
export async function extractLinesFromPdf(bytes: Uint8Array, maxPages: number): Promise<string[] | null> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(bytes);
  if (pdf.numPages > maxPages) return null;
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).flatMap((page) => page.split(/\r?\n/));
}

function mergeItems(primary: RawCatalogItem[], secondary: RawCatalogItem[]): RawCatalogItem[] {
  const seen = new Set(primary.map((i) => normalizeProductName(i.name)));
  return [...primary, ...secondary.filter((i) => !seen.has(normalizeProductName(i.name)))];
}

// (\b is ASCII-only even with the u flag, so the word end is checked by hand.)
const DURATION =
  /(\d{1,3}(?:[.,]\d)?)\s*(h|hr|hrs|hours?|heures?|ساعة|ساعات|m|min|mins|minutes?|دقيقة|دقائق|د)(?![\p{L}\p{N}])/iu;

/** "30 min", "1.5 hours", "45 دقيقة" → minutes (5–480), else null. */
export function parseDuration(text: string): number | null {
  const m = DURATION.exec(toWesternDigits(text));
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  const minutes = /^(h|hr|hrs|hour|hours|heure|heures|ساعة|ساعات)$/iu.test(m[2]) ? value * 60 : value;
  return minutes >= 5 && minutes <= 480 ? Math.round(minutes) : null;
}

/**
 * Decides what can be added: a readable name, not already in the catalog,
 * and (products) a listed price. A price in another currency is never
 * converted: the product is added as a draft that needs the owner's price,
 * a service without a price ("price on request"). Everything else is
 * counted, never guessed.
 */
export function prepareCatalogItems(
  raw: RawCatalogItem[],
  options: { tenantCurrency: string; kind: "product" | "service"; existingNames: Set<string> },
): PrepareResult {
  const out: PrepareResult = { items: [], needsPrice: 0, skipped: { unpriced: 0, duplicates: 0, unreadable: 0 } };
  const seen = new Set<string>();
  for (const item of raw) {
    const duration = options.kind === "service" ? parseDuration(`${item.name} ${item.description ?? ""}`) : null;
    // A service's duration written into its name ("Haircut 30 min") is not part of the name.
    const name = (options.kind === "service" ? item.name.replace(DURATION, "") : item.name)
      .replace(/[\s\-–—|:·.]+$/u, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    const key = normalizeProductName(name);
    if (!name || !isReadableName(name)) {
      out.skipped.unreadable += 1;
      continue;
    }
    if (seen.has(key) || options.existingNames.has(key)) {
      out.skipped.duplicates += 1;
      continue;
    }
    const price = item.amount ? parseAmount(item.amount) : null;
    if (price === null && options.kind === "product") {
      out.skipped.unpriced += 1;
      continue;
    }
    const foreign = Boolean(item.currency && item.currency.toUpperCase() !== options.tenantCurrency.toUpperCase());
    if (foreign) out.needsPrice += 1;
    seen.add(key);
    out.items.push({
      name,
      priceMajor: foreign ? null : price,
      ...(foreign && options.kind === "product"
        ? { sourcePrice: { amount: item.amount ?? null, currency: item.currency?.toUpperCase() ?? null } }
        : {}),
      category: item.category?.trim().slice(0, 120) || null,
      description: item.description?.trim().slice(0, 2000) || null,
      durationMinutes: duration,
    });
  }
  return out;
}
