import { extractFromHtml, type PageExtraction } from "./extract";
import { CATALOG_KINDS, classifyPage, isOrderingLink, kindFromUrl, type PageKind } from "./page-kind";
import { canonicalizeUrl, sameSite, type FetchPage } from "./website";
import { isPathAllowed, parseRobotsTxt, type RobotsRules } from "../robots";
import { safeFetch } from "../safe-fetch";

/**
 * Direct menu / catalog URL ingestion. The URL the owner gave is the
 * PRIMARY source and is always read deeply (text, structured data,
 * embedded data and images). Around it, a controlled same-domain
 * discovery reads only related menu/catalog/ordering pages (default ≤ 10),
 * never the whole site. A linked online-ordering page is followed when it
 * is public and its robots.txt allows it — never through logins,
 * CAPTCHAs, private APIs, or third-party marketplaces (those need the
 * platform's own integration).
 */
export const CATALOG_LIMITS = { relatedPages: 10, orderingPages: 2, concurrency: 3, pageTimeoutMs: 10_000, maxPageBytes: 2_500_000, minDelayMs: 250 };

/** Marketplaces whose terms don't permit automated collection — detected and reported, never read. */
export const MARKETPLACE_HOSTS = [
  "talabat.com",
  "hungerstation.com",
  "jahez.net",
  "jahezapp.com",
  "mrsool.co",
  "toyou.io",
  "thechefz.co",
  "careem.com",
  "keeta.com",
  "noon.com",
  "deliveroo.com",
  "deliveroo.ae",
  "ubereats.com",
  "doordash.com",
  "grubhub.com",
  "zomato.com",
  "glovoapp.com",
  "wolt.com",
  "foodpanda.com",
  "just-eat.com",
  "justeat.com",
  "instashop.com",
];

export type CatalogRole = "direct" | "related" | "ordering";

export type CatalogPage = {
  url: string;
  finalUrl: string;
  canonicalUrl: string;
  role: CatalogRole;
  kind: PageKind;
  kindSignals: string[];
  linkText: string | null;
  extraction: PageExtraction;
  truncated: boolean;
};

export type OrderingLink = { url: string; text: string; status: "read" | "not_read"; reason: string | null };

export type CatalogOutcome = {
  direct: CatalogPage;
  pages: CatalogPage[];
  ordering: OrderingLink[];
  skippedByRobots: string[];
  failed: { url: string; reason: string }[];
};

export class CatalogBlockedError extends Error {}

export function isMarketplace(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return MARKETPLACE_HOSTS.some((m) => h === m || h.endsWith(`.${m}`));
}

export async function crawlCatalog(
  directUrl: URL,
  options: {
    fetchPage?: FetchPage;
    declared?: PageKind | null;
    /** Canonical URLs already read in this job (not fetched twice). */
    exclude?: Set<string>;
    limits?: Partial<typeof CATALOG_LIMITS>;
    shouldStop?: () => Promise<boolean> | boolean;
  } = {},
): Promise<CatalogOutcome> {
  const limits = { ...CATALOG_LIMITS, ...options.limits };
  const fetchPage = options.fetchPage ?? safeFetch;
  const robotsCache = new Map<string, Promise<RobotsRules>>();
  const robotsFor = (u: URL) => {
    const origin = u.origin;
    if (!robotsCache.has(origin)) robotsCache.set(origin, loadRobots(u, fetchPage, limits.pageTimeoutMs));
    return robotsCache.get(origin)!;
  };
  const skippedByRobots: string[] = [];
  const failed: { url: string; reason: string }[] = [];

  const read = async (target: URL, role: CatalogRole, linkText: string | null, allowHost: (u: URL) => boolean): Promise<CatalogPage | null> => {
    const robots = await robotsFor(target);
    if (!isPathAllowed(robots, target.pathname || "/")) {
      skippedByRobots.push(target.toString());
      return null;
    }
    const result = await fetchPage(target, { timeoutMs: limits.pageTimeoutMs, maxBytes: limits.maxPageBytes, allowUrl: allowHost });
    if (!result.ok) {
      failed.push({ url: target.toString(), reason: result.message });
      return null;
    }
    const extraction = extractFromHtml(result.body, result.url.toString());
    const declared = role === "direct" ? (options.declared ?? null) : role === "ordering" ? "ONLINE_ORDERING" : null;
    const kind = classifyPage(result.url, extraction, { linkText: linkText ?? undefined, declared });
    const declaredCanonical = extraction.canonical ? canonicalizeUrl(extraction.canonical) : null;
    return {
      url: target.toString(),
      finalUrl: result.url.toString(),
      canonicalUrl: declaredCanonical && sameSite(new URL(extraction.canonical!), result.url) ? declaredCanonical : canonicalizeUrl(result.url)!,
      role,
      kind: kind.kind,
      kindSignals: kind.signals,
      linkText,
      extraction,
      truncated: result.truncated,
    };
  };

  // 1. The direct URL — mandatory.
  const direct = await read(directUrl, "direct", null, (u) => sameSite(u, directUrl));
  if (!direct) {
    if (skippedByRobots.length > 0) throw new CatalogBlockedError("The website's robots.txt does not allow reading this page.");
    throw new Error(`The menu page could not be read (${failed[0]?.reason ?? "unknown error"}).`);
  }
  const site = new URL(direct.finalUrl);
  const seen = new Set<string>([direct.canonicalUrl, ...(options.exclude ?? [])]);

  // 2. Link discovery: the direct page's links; its homepage's navigation too when the page itself links little.
  let links = direct.extraction.links;
  if (links.filter((l) => sameSite(new URL(l.url), site)).length < 5 && site.pathname !== "/") {
    const home = await read(new URL("/", site), "related", null, (u) => sameSite(u, site));
    if (home) links = [...links, ...home.extraction.links];
  }

  const related: { url: URL; text: string; score: number }[] = [];
  const ordering: OrderingLink[] = [];
  const orderingTargets: { url: URL; text: string }[] = [];
  const directTokens = pathTokens(site);
  for (const link of links) {
    let u: URL;
    try {
      u = new URL(link.url);
    } catch {
      continue;
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") continue;
    const canonical = canonicalizeUrl(u);
    if (!canonical || seen.has(canonical)) continue;

    if (!sameSite(u, site) && (isMarketplace(u.hostname) || isOrderingLink(u, link.text))) {
      if (ordering.some((o) => canonicalizeUrl(o.url) === canonical)) continue;
      if (isMarketplace(u.hostname)) {
        ordering.push({ url: u.toString(), text: link.text, status: "not_read", reason: "Third-party marketplace — connect it through the platform's official integration." });
      } else if (orderingTargets.length < limits.orderingPages) {
        orderingTargets.push({ url: u, text: link.text });
      }
      seen.add(canonical);
      continue;
    }
    if (!sameSite(u, site)) continue;
    const k = kindFromUrl(u, link.text);
    if (!CATALOG_KINDS.has(k.kind)) continue;
    // Pages that share words with the direct URL ("/breakfast" → "/breakfast-menu-gallery") rank first.
    const shared = pathTokens(u).filter((t) => directTokens.includes(t)).length;
    related.push({ url: u, text: link.text, score: k.score * 10 + (k.kind === "MENU" ? 5 : 0) + shared * 4 - u.pathname.split("/").length });
    seen.add(canonical);
  }
  related.sort((a, b) => b.score - a.score);

  // 3. Read related pages (bounded, polite) and permitted ordering pages.
  const pages: CatalogPage[] = [direct];
  const targets: { url: URL; text: string; role: CatalogRole }[] = [
    ...related.slice(0, limits.relatedPages).map((r) => ({ url: r.url, text: r.text, role: "related" as const })),
    ...orderingTargets.map((o) => ({ ...o, role: "ordering" as const })),
  ];
  let next = 0;
  const workers = Array.from({ length: Math.min(limits.concurrency, targets.length) }, async () => {
    while (next < targets.length) {
      const t = targets[next++];
      if (await options.shouldStop?.()) return;
      if (next > limits.concurrency) await new Promise((r) => setTimeout(r, limits.minDelayMs));
      const page = await read(t.url, t.role, t.text, t.role === "ordering" ? (u) => sameSite(u, t.url) : (u) => sameSite(u, site));
      if (t.role === "ordering") {
        ordering.push({
          url: t.url.toString(),
          text: t.text,
          status: page ? "read" : "not_read",
          reason: page ? null : skippedByRobots.includes(t.url.toString()) ? "Its robots.txt does not allow automated reading." : "Not publicly readable.",
        });
      }
      if (page && !pages.some((p) => p.canonicalUrl === page.canonicalUrl)) pages.push(page);
    }
  });
  await Promise.all(workers);

  return { direct, pages, ordering, skippedByRobots, failed };
}

function pathTokens(u: URL): string[] {
  return u.pathname
    .toLowerCase()
    .split(/[^a-z0-9؀-ۿ]+/)
    .filter((t) => t.length > 2 && !["menu", "menus", "page", "gallery", "html", "php"].includes(t));
}

async function loadRobots(u: URL, fetchPage: FetchPage, timeoutMs: number): Promise<RobotsRules> {
  const result = await fetchPage(new URL("/robots.txt", u.origin), {
    timeoutMs,
    maxBytes: 200_000,
    accept: ["text/plain", "text/html", "application/octet-stream"],
    allowUrl: (x) => sameSite(x, u),
  });
  return result.ok && !/^\s*</.test(result.body) ? parseRobotsTxt(result.body) : { disallow: [], allow: [], crawlDelaySeconds: null, sitemaps: [] };
}
