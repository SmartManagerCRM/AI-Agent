import * as cheerio from "cheerio";

/**
 * Deterministic HTML extraction (spec §9). No script execution — cheerio
 * parses markup as a DOM, it never runs page JavaScript, which is what makes
 * treating website content as untrusted input (spec §23) safe here. AI-based
 * structured extraction (turning this into draft products/branches) is a
 * later phase once the AI Gateway (Phase 3) exists; this only pulls out
 * what is deterministically present in the markup.
 */
export type ExtractedPage = {
  title: string | null;
  metaDescription: string | null;
  jsonLd: Record<string, unknown>[];
  text: string;
  links: string[];
};

const MAX_TEXT_LENGTH = 4000;

export function extractPage(html: string, pageUrl: string): ExtractedPage {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;

  // Extracted before the removal pass below, which drops every <script> tag
  // (JSON-LD included) so it can't end up concatenated into the visible text.
  const jsonLd: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    try {
      const parsed: unknown = JSON.parse(raw);
      for (const item of Array.isArray(parsed) ? parsed : [parsed]) {
        if (item && typeof item === "object") jsonLd.push(item as Record<string, unknown>);
      }
    } catch {
      // Malformed JSON-LD on the page is not our problem to fix; skip it.
    }
  });

  $("script, style, noscript, template").remove();
  const text = $("body").text().replace(/\s+/g, " ").trim().slice(0, MAX_TEXT_LENGTH);

  const base = safeUrl(pageUrl);
  const links = new Set<string>();
  if (base) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href");
      if (!href) return;
      const resolved = safeUrl(href, base);
      if (resolved && (resolved.protocol === "http:" || resolved.protocol === "https:")) {
        resolved.hash = "";
        links.add(resolved.toString());
      }
    });
  }

  return { title, metaDescription, jsonLd, text, links: [...links] };
}

function safeUrl(value: string, base?: URL): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

/** Picks LocalBusiness/Restaurant/Organization-shaped JSON-LD entries, if any. */
export function findBusinessJsonLd(jsonLd: Record<string, unknown>[]): Record<string, unknown> | null {
  const types = new Set(["LocalBusiness", "Restaurant", "CafeOrCoffeeShop", "Organization", "Store"]);
  for (const item of jsonLd) {
    const type = item["@type"];
    const typeList = Array.isArray(type) ? type : [type];
    if (typeList.some((t) => typeof t === "string" && types.has(t))) return item;
  }
  return null;
}
