import { describe, expect, it } from "vitest";

import { safeFetch, type SafeFetchOptions } from "@/server/brain/safe-fetch";
import { UnsafeCrawlTargetError } from "@/server/brain/url-safety";
import { canonicalizeUrl, crawlWebsite, parseSitemap } from "@/server/brain/discovery/website";

/** Pretend DNS: *.internal and 10.x are private; everything else public. */
const fakeGuard = async (url: URL) => {
  if (url.hostname.endsWith(".internal") || url.hostname.startsWith("10.")) throw new UnsafeCrawlTargetError("private");
};

describe("safeFetch", () => {
  it("re-checks every redirect hop against the SSRF guard", async () => {
    const fetcher = (async (url: URL) =>
      url.hostname === "public.example"
        ? new Response(null, { status: 302, headers: { location: "http://metadata.internal/latest" } })
        : new Response("secret", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const result = await safeFetch(new URL("https://public.example/"), { fetcher, assertTarget: fakeGuard });
    expect(result).toMatchObject({ ok: false, reason: "blocked" });
  });

  it("caps the body size and refuses unexpected content types", async () => {
    const big = (async () => new Response("x".repeat(5000), { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    const capped = await safeFetch(new URL("https://public.example/"), { fetcher: big, assertTarget: fakeGuard, maxBytes: 1000 });
    expect(capped).toMatchObject({ ok: true, bytes: 1000, truncated: true });

    const pdf = (async () => new Response("%PDF", { headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch;
    expect(await safeFetch(new URL("https://public.example/a.pdf"), { fetcher: pdf, assertTarget: fakeGuard })).toMatchObject({
      ok: false,
      reason: "unsupported_type",
    });
  });
});

describe("canonicalizeUrl / parseSitemap", () => {
  it("collapses scheme, www, tracking params, fragments and trailing slashes", () => {
    expect(canonicalizeUrl("http://www.Cafe.sa/menu/?utm_source=ig&b=2&a=1#top")).toBe("https://cafe.sa/menu?a=1&b=2");
    expect(canonicalizeUrl("https://cafe.sa/index.html")).toBe("https://cafe.sa");
    expect(canonicalizeUrl("javascript:alert(1)")).toBeNull();
  });

  it("reads sitemap indexes and url sets", () => {
    expect(parseSitemap("<sitemapindex><sitemap><loc>https://c.sa/s1.xml</loc></sitemap></sitemapindex>")).toEqual({
      pages: [],
      sitemaps: ["https://c.sa/s1.xml"],
    });
    expect(parseSitemap("<urlset><url><loc><![CDATA[https://c.sa/menu?a=1&amp;b=2]]></loc></url></urlset>").pages).toEqual([
      "https://c.sa/menu?a=1&b=2",
    ]);
  });
});

describe("crawlWebsite", () => {
  const site: Record<string, { type: string; body: string }> = {
    "https://cafe.sa/": {
      type: "text/html",
      body: `<a href="/menu">Menu</a><a href="/contact">Contact</a><a href="/blog/x">Blog</a><a href="/private">Staff</a>
             <a href="https://other.example/menu">Partner</a><a href="/menu?utm_source=nav">Menu again</a>`,
    },
    "https://cafe.sa/robots.txt": { type: "text/plain", body: "User-agent: *\nDisallow: /private\nSitemap: https://cafe.sa/sitemap.xml" },
    "https://cafe.sa/sitemap.xml": { type: "application/xml", body: "<urlset><url><loc>https://cafe.sa/refund-policy</loc></url></urlset>" },
    "https://cafe.sa/menu": { type: "text/html", body: "<li>Latte 18 SAR</li><a href='/menu/desserts'>Desserts</a>" },
    "https://cafe.sa/menu/desserts": { type: "text/html", body: "<li>Cheesecake 22 SAR</li>" },
    "https://cafe.sa/contact": { type: "text/html", body: "<a href='tel:+966112345678'>Call</a>" },
    "https://cafe.sa/refund-policy": { type: "text/html", body: "<p>Refunds within 24 hours.</p>" },
  };
  const requested: string[] = [];
  const fetchPage = async (url: URL, options: SafeFetchOptions) => {
    requested.push(url.toString());
    const fetcher = (async (u: URL) => {
      const page = site[u.toString()];
      return page ? new Response(page.body, { headers: { "content-type": page.type } }) : new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    return safeFetch(url, { ...options, fetcher, assertTarget: fakeGuard });
  };

  it("reads the right pages: same site, robots-respecting, de-duplicated, ranked, one level deeper", async () => {
    const outcome = await crawlWebsite(new URL("https://cafe.sa/"), { category: "food_service", fetchPage, limits: { minDelayMs: 0 } });
    const urls = outcome.pages.map((p) => p.canonicalUrl);
    expect(urls[0]).toBe("https://cafe.sa");
    expect(urls).toEqual(expect.arrayContaining(["https://cafe.sa/menu", "https://cafe.sa/contact", "https://cafe.sa/refund-policy", "https://cafe.sa/menu/desserts"]));
    expect(requested.some((u) => u.includes("other.example"))).toBe(false);
    expect(requested.some((u) => u.endsWith("/private"))).toBe(false);
    expect(requested.some((u) => u.includes("/blog"))).toBe(false);
    expect(requested.filter((u) => u.startsWith("https://cafe.sa/menu?")).length).toBe(0);
    expect(outcome.skippedByRobots).toBe(1);
    const menu = outcome.pages.find((p) => p.canonicalUrl === "https://cafe.sa/menu");
    expect(menu?.topic).toBe("offerings");
    expect(menu?.extraction.offerings[0]).toMatchObject({ name: "Latte", amount: "18.00", currency: "SAR" });
  });
});
