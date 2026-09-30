import { describe, expect, it } from "vitest";

import { normalizeVision } from "@/server/brain/discovery/ai-extract";
import { crawlCatalog, isMarketplace } from "@/server/brain/discovery/catalog";
import { extractFromHtml } from "@/server/brain/discovery/extract";
import { factsFromCatalogPages, factsFromMenuImages, normalizeProductName, offeringKey } from "@/server/brain/discovery/facts";
import { EXTRACTABLE, triageImage } from "@/server/brain/discovery/image-triage";
import { classifyPage, kindFromUrl } from "@/server/brain/discovery/page-kind";
import { bestFromSrcset, offeringsFromEmbeddedJson, resolveImageUrl } from "@/server/brain/discovery/page-media";
import { directMenuUrls, websiteRootOf } from "@/server/brain/discovery/pipeline";
import { safeFetch, type SafeFetchOptions } from "@/server/brain/safe-fetch";

const WIX = (id: string, w = 980, h = 1386) => `https://static.wixstatic.com/media/${id}~mv2.jpg/v1/fill/w_${w},h_${h},al_c,q_85/${id}.jpg`;

/** A breakfast page shaped like a Wix restaurant site: menu sheets as images, a nav, an ORDER NOW button. */
const breakfastPage = `<!doctype html><html><head><title>Breakfast | Khayal Restaurant</title>
<meta property="og:image" content="${WIX("og_cover", 1200, 630)}"></head><body>
<header><a href="/"><img src="${WIX("logo_small", 120, 60)}" alt="Khayal logo" width="120" height="60"></a>
<nav><a href="/">Home</a><a href="/breakfast">Breakfast</a><a href="/lunch-menu">Lunch</a><a href="/breakfast-menu-gallery">Breakfast gallery</a>
<a href="/about">About</a><a href="/contact">Contact</a><a href="https://order.khayal-food.example/">ORDER NOW</a><a href="https://www.talabat.com/ksa/khayal">Talabat</a></nav></header>
<main><h1>BREAKFAST</h1>
${[1, 2, 3, 4, 5, 6]
  .map((n) => `<wow-image><img src="${WIX(`menu_b${n}`, 490, 693)}" srcset="${WIX(`menu_b${n}`, 490, 693)} 1x, ${WIX(`menu_b${n}`, 980, 1386)} 2x" alt="" width="490" height="693"></wow-image>`)
  .join("")}
<div style="background-image:url('${WIX("texture_bg", 1920, 400)}')"></div>
</main><footer><img src="https://static.wixstatic.com/media/instagram_icon~mv2.png" alt="Instagram" width="24" height="24"></footer>
<script type="application/json" id="wix-warmup-data">{"gallery":{"items":[{"url":"${WIX("menu_b3")}"}]}}</script>
</body></html>`;

describe("page media", () => {
  it("finds every menu image on an image-based page, using the original rendition and one key per picture", () => {
    const x = extractFromHtml(breakfastPage, "https://www.khayalrest.example/breakfast");
    const menus = x.images.filter((i) => i.key.startsWith("wix:menu_b"));
    expect(menus).toHaveLength(6);
    expect(menus[0]).toMatchObject({ url: "https://static.wixstatic.com/media/menu_b1~mv2.jpg", width: 490, height: 693, inChrome: false, source: "img" });
    expect(x.images.find((i) => i.key.includes("logo_small"))?.inChrome).toBe(true);
    expect(x.images.some((i) => i.source === "background")).toBe(true);
    expect(x.images.some((i) => i.source === "og")).toBe(true);
  });

  it("resolves srcsets and CDN size variants", () => {
    expect(bestFromSrcset("a.jpg 480w, b.jpg 1080w, c.jpg 720w")).toBe("b.jpg");
    expect(resolveImageUrl("https://cdn.shop.example/files/latte_600x800.jpg?v=3", null)?.key).toBe("cdn.shop.example/files/latte.jpg");
    expect(resolveImageUrl("data:image/png;base64,xx", null)).toBeNull();
  });

  it("reads products from embedded catalog JSON, currency only when stated", () => {
    const items = offeringsFromEmbeddedJson({
      menu: { categories: [{ name: "Breakfast", items: [{ name: "Falafel Plate", price: 27, currency: "SAR" }, { name: "Tea", price: "6" }] }] },
    });
    expect(items).toEqual([
      expect.objectContaining({ name: "Falafel Plate", amount: "27.00", currency: "SAR", category: "Breakfast", method: "structured_data" }),
      expect.objectContaining({ name: "Tea", amount: "6", currency: null }),
    ]);
  });
});

describe("page classification", () => {
  it("classifies menu/catalog/ordering pages from URL, headings and content", () => {
    expect(kindFromUrl(new URL("https://x.sa/breakfast")).kind).toBe("MENU");
    expect(kindFromUrl(new URL("https://x.sa/%D8%A7%D9%84%D9%81%D8%B7%D9%88%D8%B1")).kind).toBe("MENU"); // /الفطور
    expect(kindFromUrl(new URL("https://x.sa/services")).kind).toBe("SERVICE_CATALOG");
    expect(kindFromUrl(new URL("https://x.sa/shop")).kind).toBe("PRODUCT_CATALOG");
    expect(kindFromUrl(new URL("https://x.sa/order-online")).kind).toBe("ONLINE_ORDERING");
    expect(kindFromUrl(new URL("https://x.sa/about")).kind).toBe("BUSINESS_INFORMATION");
    const x = extractFromHtml(breakfastPage, "https://www.khayalrest.example/breakfast");
    expect(classifyPage(new URL("https://www.khayalrest.example/breakfast"), x).kind).toBe("MENU");
    // The owner's declaration wins even for an opaque URL.
    expect(classifyPage(new URL("https://x.sa/p/123"), extractFromHtml("<p>hi</p>", "https://x.sa/p/123"), { declared: "MENU" }).kind).toBe("MENU");
  });

  it("treats a deep menu link given as the website as a primary menu source, and reads the site from its homepage", () => {
    expect(directMenuUrls({ websiteUrl: "https://www.khayalrest.com/breakfast" }).map(String)).toEqual(["https://www.khayalrest.com/breakfast"]);
    expect(websiteRootOf("https://www.khayalrest.com/breakfast")).toBe("https://www.khayalrest.com/");
    expect(directMenuUrls({ websiteUrl: "https://www.khayalrest.com/" })).toEqual([]);
    expect(directMenuUrls({ menuUrls: ["x.sa/menu", "https://x.sa/menu/"] })).toHaveLength(1);
  });
});

describe("image triage", () => {
  const x = extractFromHtml(breakfastPage, "https://www.khayalrest.example/breakfast");
  const content = x.images;
  const t = (key: string) => triageImage(content.find((i) => i.key.includes(key))!, { isCatalog: true, imageCount: content.length });

  it("selects the menu sheets and never the logo, icons, banners or background", () => {
    for (let n = 1; n <= 6; n++) expect(EXTRACTABLE.has(t(`menu_b${n}`).class)).toBe(true);
    expect(t("logo_small").class).toBe("logo");
    expect(t("instagram_icon").class).not.toBe("menu_page");
    expect(EXTRACTABLE.has(t("texture_bg").class)).toBe(false);
    expect(EXTRACTABLE.has(t("og_cover").class)).toBe(false);
  });
});

describe("catalog crawl", () => {
  const site: Record<string, string> = {
    "https://www.khayalrest.example/breakfast": breakfastPage,
    "https://www.khayalrest.example/breakfast-menu-gallery": `<h1>Breakfast gallery</h1><div class="item"><h3>Shakshuka</h3></div><div class="item"><h3>Foul</h3></div>`,
    "https://www.khayalrest.example/lunch-menu": `<h1>Lunch</h1><li>Mandi 55 SAR</li>`,
    "https://www.khayalrest.example/about": "<p>About us</p>",
    "https://order.khayal-food.example/": `<script type="application/json">{"items":[{"name":"Falafel","price":27,"currency":"SAR"}]}</script>`,
  };
  const requested: string[] = [];
  const fetchPage = (url: URL, options: SafeFetchOptions) => {
    requested.push(url.toString());
    const fetcher = (async (u: URL) =>
      site[u.toString()] !== undefined
        ? new Response(site[u.toString()], { headers: { "content-type": "text/html" } })
        : u.pathname === "/robots.txt"
          ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } })
          : new Response("no", { status: 404 })) as unknown as typeof fetch;
    return safeFetch(url, { ...options, fetcher, assertTarget: async () => {} });
  };

  it("reads the direct page, related menu pages only, and the restaurant's own ordering page — never a marketplace", async () => {
    const out = await crawlCatalog(new URL("https://www.khayalrest.example/breakfast"), { fetchPage, declared: "MENU" });
    expect(out.direct.kind).toBe("MENU");
    const urls = out.pages.map((p) => `${p.role}:${p.finalUrl}`);
    expect(urls).toEqual(
      expect.arrayContaining([
        "direct:https://www.khayalrest.example/breakfast",
        "related:https://www.khayalrest.example/breakfast-menu-gallery",
        "related:https://www.khayalrest.example/lunch-menu",
        "ordering:https://order.khayal-food.example/",
      ]),
    );
    expect(requested.some((u) => u.endsWith("/about") || u.endsWith("/contact"))).toBe(false);
    expect(requested.some((u) => u.includes("talabat"))).toBe(false);
    expect(out.ordering).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ url: "https://www.talabat.com/ksa/khayal", status: "not_read" }),
        expect.objectContaining({ url: "https://order.khayal-food.example/", status: "read" }),
      ]),
    );
    // The gallery (related) ranks above lunch because it shares "breakfast" with the direct link.
    const related = out.pages.filter((p) => p.role === "related").map((p) => new URL(p.finalUrl).pathname);
    expect(related[0]).toBe("/breakfast-menu-gallery");
    expect(isMarketplace("www.hungerstation.com")).toBe(true);
  });
});

describe("merging sources into one Brain", () => {
  it("normalizes names so the same dish from different sources shares one fact key", () => {
    expect(normalizeProductName("الشكشوكة")).toBe(normalizeProductName("شكشوكه"));
    expect(offeringKey("Falafel")).toBe(offeringKey("falafel "));
    expect(offeringKey("Crème brûlée")).toBe(offeringKey("Creme Brulee"));
  });

  it("gives each source its own candidate and compares only prices (conflict_value)", () => {
    const page = factsFromCatalogPages([
      { url: "https://o.example/", role: "ordering", kind: "ONLINE_ORDERING", extraction: { offerings: [{ name: "Falafel", amount: "27.00", currency: "SAR", description: null, category: null, kind: "product", method: "structured_data" }] } },
      { url: "https://k.example/gallery", role: "related", kind: "MENU", extraction: { offerings: [{ name: "Falafel", amount: null, currency: null, description: null, category: null, kind: "product", method: "deterministic" }] } },
    ]);
    const image = factsFromMenuImages([
      { name: "falafel", secondaryName: "فلافل", amount: "25.00", currency: "SAR", category: "Breakfast", description: null, variants: [], modifiers: [], size: null, ingredients: [], dietary: [], availability: null, method: "vision", model: "gemini-2.5-flash-lite", confidence: 70, imageUrl: "https://img/b1.jpg", pageUrl: "https://k.example/breakfast" },
    ]);
    const all = [...page, ...image];
    expect(new Set(all.map((f) => f.factKey)).size).toBe(1);
    expect(all.map((f) => [f.source, f.confidence, f.content.conflict_value])).toEqual([
      ["online_ordering", 88, { amount: "27.00", currency: "SAR" }],
      ["online_menu", 80, null],
      ["image", 70, { amount: "25.00", currency: "SAR" }],
    ]);
    expect(image[0].content).toMatchObject({ source_kind: "MENU_IMAGE", source_image_url: "https://img/b1.jpg", extraction: "VISION_OCR", secondary_name: "فلافل" });
    expect(image[0].method).toBe("vision");
  });
});

describe("vision output checks", () => {
  it("keeps original names, drops illegible items, takes currency only when printed, and cross-checks prices with OCR", () => {
    const out = normalizeVision(
      {
        is_menu: true,
        menu_currency: "ر.س",
        items: [
          { product_name: "شكشوكة", secondary_name: "Shakshuka", price: "٣٢", category: "الفطور", confidence: 0.9 },
          { product_name: "Blurry thing", price: "99", confidence: 0.3 },
          { product_name: "Foul", price: 18, confidence: 0.8 },
        ],
      },
      "الفطور شكشوكة 32 فول 18",
    );
    expect(out.items.map((i) => [i.name, i.amount, i.currency])).toEqual([
      ["شكشوكة", "32.00", "SAR"],
      ["Foul", "18.00", "SAR"],
    ]);
    expect(out.categories).toEqual(["الفطور"]);
    expect(normalizeVision({ is_menu: false, items: [{ product_name: "x", price: "1" }] }, null)).toEqual({ isMenu: false, items: [], categories: [] });
  });
});
