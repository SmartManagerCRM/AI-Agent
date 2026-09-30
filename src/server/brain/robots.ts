/**
 * Minimal robots.txt parser (spec §9: "the crawler must respect robots.txt
 * where applicable"). Only the rules that matter for a single-purpose
 * onboarding crawler: prefix-matched Allow/Disallow for `User-agent: *`
 * (this crawler does not identify as any specific named bot) and a
 * best-effort Crawl-delay. No wildcards/`$` anchors — a conservative
 * subset, not a full RFC 9309 implementation.
 */
export type RobotsRules = {
  disallow: string[];
  allow: string[];
  crawlDelaySeconds: number | null;
  /** `Sitemap:` lines (group-independent per RFC 9309). */
  sitemaps?: string[];
};

export function parseRobotsTxt(text: string): RobotsRules {
  const disallow: string[] = [];
  const allow: string[] = [];
  let crawlDelaySeconds: number | null = null;
  const sitemaps: string[] = [];
  let inWildcardGroup = false;
  let sawAnyGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const sepIndex = line.indexOf(":");
    if (sepIndex === -1) continue;
    const field = line.slice(0, sepIndex).trim().toLowerCase();
    const value = line.slice(sepIndex + 1).trim();

    if (field === "sitemap") {
      if (value && sitemaps.length < 10) sitemaps.push(value);
      continue;
    }
    if (field === "user-agent") {
      inWildcardGroup = value === "*";
      sawAnyGroup = true;
      continue;
    }
    // A directive before any User-agent line applies to nobody per spec;
    // treat it as belonging to an implicit wildcard group for tolerance.
    const applies = inWildcardGroup || !sawAnyGroup;
    if (!applies) continue;

    if (field === "disallow" && value) disallow.push(value);
    else if (field === "allow" && value) allow.push(value);
    else if (field === "crawl-delay") {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) crawlDelaySeconds = seconds;
    }
  }

  return { disallow, allow, crawlDelaySeconds, sitemaps };
}

/** Longest matching Allow beats longest matching Disallow (standard tie-break). */
export function isPathAllowed(rules: RobotsRules, path: string): boolean {
  const longestMatch = (patterns: string[]) =>
    patterns.reduce((best, pattern) => (path.startsWith(pattern) && pattern.length > best ? pattern.length : best), -1);

  const disallowLen = longestMatch(rules.disallow);
  if (disallowLen === -1) return true;
  const allowLen = longestMatch(rules.allow);
  return allowLen >= disallowLen;
}
