import { describe, expect, it } from "vitest";

import { classifyFromGoogle, classifyFromSchemaTypes, guessFromAi } from "@/server/brain/discovery/business-type";
import { classifyTopic, scorePage, selectPages } from "@/server/brain/discovery/source-router";

describe("business type classification", () => {
  it("trusts a mapped Google primary type", () => {
    expect(classifyFromGoogle({ primaryType: "coffee_shop", types: ["coffee_shop", "food"] })).toMatchObject({
      key: "cafe",
      category: "food_service",
      confidence: 95,
      source: "google_types",
      version: "type-v1",
    });
    expect(classifyFromGoogle({ primaryType: "italian_restaurant", types: [] })).toMatchObject({ key: "restaurant" });
    expect(classifyFromGoogle({ primaryType: "dental_clinic", types: [] })).toMatchObject({ key: "clinic", category: "healthcare" });
    expect(classifyFromGoogle({ primaryType: "electronics_store", types: [] })).toMatchObject({ key: "other", category: "retail" });
  });

  it("falls back to a unanimous vote of secondary types", () => {
    expect(classifyFromGoogle({ primaryType: null, types: ["hair_salon", "beauty_salon", "establishment"] })).toMatchObject({
      key: "salon",
      confidence: 80,
    });
  });

  it("is ambiguous (null) on generic-only or split types — the case where AI may be asked", () => {
    expect(classifyFromGoogle({ primaryType: "point_of_interest", types: ["establishment", "food"] })).toBeNull();
    expect(classifyFromGoogle({ primaryType: null, types: ["gym", "spa"] })).toBeNull();
  });

  it("reads schema.org LocalBusiness subtypes", () => {
    expect(classifyFromSchemaTypes(["CafeOrCoffeeShop"])).toMatchObject({ key: "cafe", source: "website_schema" });
    expect(classifyFromSchemaTypes(["LocalBusiness"])).toBeNull();
  });

  it("caps AI answers below deterministic sources and rejects off-vocabulary answers", () => {
    expect(guessFromAi({ key: "gym", category: "fitness", confidence: 99 })).toMatchObject({ key: "gym", confidence: 65, source: "ai" });
    expect(guessFromAi({ key: "casino", category: "fitness" })).toBeNull();
  });
});

describe("source intelligence router", () => {
  it("classifies pages by multilingual URL and link-text signals", () => {
    expect(classifyTopic(new URL("https://x.sa/"))).toBe("home");
    expect(classifyTopic(new URL("https://x.sa/our-menu"))).toBe("offerings");
    expect(classifyTopic(new URL("https://x.sa/fr/nos-services"))).toBe("offerings");
    expect(classifyTopic(new URL("https://x.sa/%D8%A7%D9%84%D8%A3%D8%B3%D8%B9%D8%A7%D8%B1"))).toBe("pricing"); // /الأسعار
    expect(classifyTopic(new URL("https://x.sa/p/12"), "احجز موعدك")).toBe("booking");
    expect(classifyTopic(new URL("https://x.sa/refund-policy"))).toBe("policies");
    expect(classifyTopic(new URL("https://x.sa/menu/login"))).toBe("account");
    expect(classifyTopic(new URL("https://x.sa/privacy"))).toBe("legal");
  });

  it("adapts weights to the business category without industry-specific code", () => {
    const booking = { url: "https://x.sa/book", depth: 1 };
    expect(scorePage(booking, "beauty").score).toBeGreaterThan(scorePage(booking, "food_service").score);
    const order = { url: "https://x.sa/order-online", depth: 1 };
    expect(scorePage(order, "food_service").score).toBeGreaterThan(scorePage(order, "engineering").score);
    const doctors = { url: "https://x.sa/our-doctors", depth: 1 };
    expect(scorePage(doctors, "healthcare").score).toBeGreaterThan(scorePage(doctors, "retail").score);
  });

  it("excludes assets, account, legal, blog and career pages", () => {
    for (const url of ["https://x.sa/logo.png", "https://x.sa/login", "https://x.sa/privacy-policy-cookies", "https://x.sa/blog/post", "https://x.sa/careers"]) {
      expect(scorePage({ url, depth: 1 }, "general").tier).toBe("excluded");
    }
  });

  it("selects the homepage first, respects per-topic caps and the page budget", () => {
    const candidates = [
      { url: "https://x.sa/", depth: 0 },
      ...Array.from({ length: 10 }, (_, i) => ({ url: `https://x.sa/menu/section-${i}`, depth: 1, linkText: "Menu" })),
      { url: "https://x.sa/contact", depth: 1, linkText: "Contact" },
      { url: "https://x.sa/blog", depth: 1 },
    ];
    const picked = selectPages(candidates, "food_service", 8);
    expect(picked[0].url).toBe("https://x.sa/");
    expect(picked.filter((p) => p.topic === "offerings")).toHaveLength(6);
    expect(picked.some((p) => p.url.endsWith("/contact"))).toBe(true);
    expect(picked.some((p) => p.url.endsWith("/blog"))).toBe(false);
    expect(picked.length).toBeLessThanOrEqual(8);
  });
});
