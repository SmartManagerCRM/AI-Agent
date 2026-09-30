import { extractFromHtml, type PageExtraction } from "./extract";
import { selectPages, type PageCandidate, type RankedPage } from "./source-router";
import type { BusinessCategory } from "./business-type";
import { isPathAllowed, parseRobotsTxt, type RobotsRules } from "../robots";
import { safeFetch, type SafeFetchOptions, type SafeFetchResult } from "../safe-fetch";

/**
 * Website discovery: homepage → robots.txt → sitemap(s) → navigation links
 * → ranked, capped page list (Source Intelligence Router) → fetched and
 * deterministically extracted pages. Same-site only, robots-compliant,
 * canonical-URL de-duplicated, every request through `safeFetch`.
 */
export const WEBSITE_LIMITS = {
  maxPages: 12,
  maxDepth: 2,
  maxSitemapFiles: 4,
  maxSitemapUrls: 400,
  maxPageBytes: 1_500_000,
  pageTimeoutMs: 8_000,
  concurrency: 3,
  minDelayMs: 250,
  maxCrawlDelayMs: 2_000,
};

export type FetchPage = (url: URL, options: SafeFetchOptions) => Promise<SafeFetchResult>;

export type CrawledPage = RankedPage & {
  finalUrl: string;
  canonicalUrl: string;
  extraction: PageExtraction;
  truncated: boolean;
};

export type CrawlOutcome = {
  origin: string;
  pages: CrawledPage[];
  failed: { url: string; reason: string }[];
  skippedByRobots: number;
  sitemapUrls: number;
  candidates: number;
};

const TRACKING_PARAMS = /^(utm_[a-z]+|gclid|fbclid|msclkid|mc_[a-z]+|ref|ref_src|_ga|igshid|yclid)$/i;

/** One canonical form per page: https-agnostic key, no www, no fragment, no tracking params, sorted query, no trailing slash. */
export function canonicalizeUrl(input: string | URL, base?: URL): string | null {
  let url: URL;
  try {
    url = new URL(input.toString(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  url.protocol = "https:";
  url.port = "";
  const params = [...url.searchParams.entries()].filter(([k]) => !TRACKING_PARAMS.test(k)).sort(([a], [b]) => a.localeCompare(b));
  url.search = params.length ? `?${new URLSearchParams(params).toString()}` : "";
  url.pathname = url.pathname.replace(/\/(index\.(html?|php))?$/i, "") || "/";
  return url.toString().replace(/\/$/, "");
}

export function sameSite(a: URL, b: URL): boolean {
  return a.hostname.toLowerCase().replace(/^www\./, "") === b.hostname.toLowerCase().replace(/^www\./, "");
}

/** `<loc>` entries of a sitemap or sitemap index (regex, not a full XML parser — sitemaps are flat). */
export function parseSitemap(xml: string): { pages: string[]; sitemaps: string[] } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const locs = [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
  return isIndex ? { pages: [], sitemaps: locs } : { pages: locs, sitemaps: [] };
}

export async function crawlWebsite(
  startUrl: URL,
  options: {
    category: BusinessCategory;
    fetchPage?: FetchPage;
    limits?: Partial<typeof WEBSITE_LIMITS>;
    /** Called when a page is fetched — lets the pipeline update counters/timeline live. */
    onPage?: (page: CrawledPage) => Promise<void> | void;
    shouldStop?: () => Promise<boolean> | boolean;
    /** Canonical URLs already read elsewhere in the job (e.g. a direct menu link) — not fetched again. */
    exclude?: Set<string>;
  },
): Promise<CrawlOutcome> {
  const limits = { ...WEBSITE_LIMITS, ...options.limits };
  const fetchPage = options.fetchPage ?? safeFetch;
  const failed: { url: string; reason: string }[] = [];

  // 1. Homepage (its final URL after same-site redirects defines the site).
  const home = await fetchPage(startUrl, {
    timeoutMs: limits.pageTimeoutMs,
    maxBytes: limits.maxPageBytes,
    allowUrl: (u) => sameSite(u, startUrl),
  });
  if (!home.ok) throw new Error(`The website could not be read (${home.message}).`);
  const site = new URL(home.url.origin);
  const onSite = (u: URL) => sameSite(u, site);

  // 2. robots.txt
  const robots = await loadRobots(site, fetchPage, limits.pageTimeoutMs);
  if (!isPathAllowed(robots, home.url.pathname || "/")) {
    throw new Error("The website's robots.txt does not allow automated reading.");
  }
  const delayMs = Math.min(Math.max((robots.crawlDelaySeconds ?? 0) * 1000, limits.minDelayMs), limits.maxCrawlDelayMs);

  // 3. Sitemaps
  const sitemapPages = await loadSitemaps(site, robots, fetchPage, limits);

  const homeExtraction = extractFromHtml(home.body, home.url.toString());
  const homeCanonical = canonicalizeUrl(home.url)!;

  // 4. Candidates, de-duplicated by canonical URL.
  const candidates = new Map<string, PageCandidate>();
  const addCandidate = (raw: string, depth: number, linkText?: string, inSitemap?: boolean) => {
    let url: URL;
    try {
      url = new URL(raw, site);
    } catch {
      return;
    }
    if (!onSite(url)) return;
    const canonical = canonicalizeUrl(url);
    if (!canonical || canonical === homeCanonical || options.exclude?.has(canonical)) return;
    const existing = candidates.get(canonical);
    if (existing) {
      existing.depth = Math.min(existing.depth, depth);
      if (linkText && !existing.linkText) existing.linkText = linkText;
      if (inSitemap) existing.inSitemap = true;
      return;
    }
    url.hash = "";
    candidates.set(canonical, { url: url.toString(), depth, linkText: linkText || undefined, inSitemap });
  };
  for (const link of homeExtraction.links) addCandidate(link.url, 1, link.text);
  for (const url of sitemapPages) addCandidate(url, 2, undefined, true);

  const blockedByRobots = new Set<string>();
  const allowedByRobots = (c: PageCandidate) => {
    const ok = isPathAllowed(robots, new URL(c.url).pathname);
    if (!ok) blockedByRobots.add(c.url);
    return ok;
  };

  const homePage: CrawledPage = {
    url: home.url.toString(),
    depth: 0,
    topic: "home",
    score: 100,
    tier: "high",
    finalUrl: home.url.toString(),
    canonicalUrl: homeCanonical,
    extraction: homeExtraction,
    truncated: home.truncated,
  };
  const pages: CrawledPage[] = [homePage];
  await options.onPage?.(homePage);
  const seen = new Set<string>([homeCanonical]);

  // 5. Rounds: rank → fetch → add their links one level deeper (up to maxDepth).
  for (let depth = 1; depth <= limits.maxDepth && pages.length < limits.maxPages; depth++) {
    const pool = [...candidates.entries()]
      .filter(([canonical, c]) => !seen.has(canonical) && c.depth <= depth)
      .map(([, c]) => c)
      .filter(allowedByRobots);
    const selected = selectPages(pool, options.category, limits.maxPages - pages.length);
    if (selected.length === 0) continue;
    for (const s of selected) seen.add(canonicalizeUrl(s.url)!);

    const fetched = await mapLimited(selected, limits.concurrency, async (target, index) => {
      if (await options.shouldStop?.()) return null;
      if (index >= limits.concurrency) await sleep(delayMs);
      const result = await fetchPage(new URL(target.url), {
        timeoutMs: limits.pageTimeoutMs,
        maxBytes: limits.maxPageBytes,
        allowUrl: onSite,
      });
      if (!result.ok) {
        failed.push({ url: target.url, reason: result.message });
        return null;
      }
      const extraction = extractFromHtml(result.body, result.url.toString());
      const declared = extraction.canonical ? canonicalizeUrl(extraction.canonical) : null;
      const canonicalUrl =
        declared && extraction.canonical && onSite(new URL(extraction.canonical)) ? declared : canonicalizeUrl(result.url)!;
      const page: CrawledPage = {
        ...target,
        finalUrl: result.url.toString(),
        canonicalUrl,
        extraction,
        truncated: result.truncated,
      };
      return page;
    });

    for (const page of fetched) {
      if (!page) continue;
      if (pages.some((p) => p.canonicalUrl === page.canonicalUrl)) continue; // two URLs, one canonical page
      pages.push(page);
      await options.onPage?.(page);
      if (depth < limits.maxDepth) for (const link of page.extraction.links) addCandidate(link.url, depth + 1, link.text);
    }
  }

  return { origin: site.origin, pages, failed, skippedByRobots: blockedByRobots.size, sitemapUrls: sitemapPages.length, candidates: candidates.size };
}

async function loadRobots(site: URL, fetchPage: FetchPage, timeoutMs: number): Promise<RobotsRules> {
  const result = await fetchPage(new URL("/robots.txt", site), {
    timeoutMs,
    maxBytes: 200_000,
    accept: ["text/plain", "text/html", "application/octet-stream"],
    allowUrl: (u) => sameSite(u, site),
  });
  return result.ok && !/^\s*</.test(result.body) ? parseRobotsTxt(result.body) : { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] };
}

async function loadSitemaps(site: URL, robots: RobotsRules, fetchPage: FetchPage, limits: typeof WEBSITE_LIMITS): Promise<string[]> {
  const queue = (robots.sitemaps?.length ? robots.sitemaps : ["/sitemap.xml"])
    .map((s) => {
      try {
        return new URL(s, site);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => u !== null && sameSite(u, site));
  const pages: string[] = [];
  let files = 0;
  while (queue.length > 0 && files < limits.maxSitemapFiles && pages.length < limits.maxSitemapUrls) {
    const next = queue.shift()!;
    files += 1;
    const result = await fetchPage(next, {
      timeoutMs: limits.pageTimeoutMs,
      maxBytes: 5_000_000,
      accept: ["application/xml", "text/xml", "application/rss+xml", "text/plain"],
      allowUrl: (u) => sameSite(u, site),
    });
    if (!result.ok) continue;
    const parsed = parseSitemap(result.body);
    for (const s of parsed.sitemaps) {
      try {
        const u = new URL(s);
        if (sameSite(u, site)) queue.push(u);
      } catch {
        // skip
      }
    }
    for (const p of parsed.pages) {
      if (pages.length >= limits.maxSitemapUrls) break;
      pages.push(p);
    }
  }
  return pages;
}

async function mapLimited<T, R>(items: T[], limit: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
