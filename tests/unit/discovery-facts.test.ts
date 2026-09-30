import { describe, expect, it } from "vitest";

import { extractFromHtml } from "@/server/brain/discovery/extract";
import { factsFromGoogle, factsFromWebsite, offeringKey } from "@/server/brain/discovery/facts";
import { normalizePlace } from "@/server/brain/discovery/google-places";
import { aiGap } from "@/server/brain/discovery/pipeline";
import { computeReadiness } from "@/server/brain/discovery/readiness";

const NOW = new Date("2026-09-30T12:00:00Z");

describe("factsFromGoogle", () => {
  const place = normalizePlace({
    id: "ChIJN1t_tDeuEmsRUsoyG83frY4",
    displayName: { text: "Roasters Café" },
    primaryType: "coffee_shop",
    businessStatus: "OPERATIONAL",
    formattedAddress: "King Fahd Rd, Riyadh",
    internationalPhoneNumber: "+966 11 234 5678",
    googleMapsUri: "https://maps.google.com/?cid=1",
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 7, minute: 0 }, close: { day: 1, hour: 23, minute: 0 } }] },
    delivery: true,
  });
  const facts = factsFromGoogle(place, null, NOW);
  const byKey = Object.fromEntries(facts.map((f) => [f.factKey, f]));

  it("marks every Google fact as an expiring, attributed, structured-API suggestion", () => {
    for (const f of facts) {
      expect(f.source).toBe("google_business");
      expect(f.method).toBe("structured_api");
      expect(f.expiresAt).toBe("2026-10-30T12:00:00.000Z");
      expect(f.content.attribution).toMatchObject({ provider: "Google Maps" });
    }
  });

  it("uses the shared fact vocabulary and flags critical facts", () => {
    expect(byKey["contact.phone"].content.normalized).toBe("+966112345678");
    expect(byKey["hours.regular"].critical).toBe(true);
    expect(byKey["capability.delivery"]).toMatchObject({ critical: true, content: { normalized: true } });
    expect(byKey["identity.name"].critical).toBe(false);
  });
});

describe("factsFromWebsite", () => {
  it("de-duplicates within the source, preferring structured data, and never gives AI top authority", () => {
    const home = extractFromHtml(
      `<script type="application/ld+json">{"@type":"Restaurant","name":"Bistro","telephone":"+966 11 000 1111","address":"Olaya St"}</script>
       <a href="tel:+966110001111">Call</a><li>Burger 30 SAR</li>`,
      "https://bistro.sa/",
    );
    const contact = extractFromHtml(`<a href="tel:+966110009999">Other</a>`, "https://bistro.sa/contact");
    const facts = factsFromWebsite([
      { url: "https://bistro.sa/", topic: "home", score: 100, extraction: home },
      { url: "https://bistro.sa/contact", topic: "contact", score: 70, extraction: contact },
      {
        url: "https://bistro.sa/menu",
        topic: "offerings",
        score: 90,
        extraction: extractFromHtml("<p>menu</p>", "https://bistro.sa/menu"),
        ai: {
          about: "A bistro.",
          offerings: [{ name: "Burger", amount: "35.00", currency: "SAR", description: null, category: null, kind: "product" }],
          policies: [{ kind: "refund", quote: "No refunds after 24 hours.", summary: "24h" }],
          faqs: [],
          hoursQuote: null,
          deliveryQuote: null,
          model: "flash-lite",
          version: "ai-extract-v1",
        },
      },
    ]);
    const byKey = Object.fromEntries(facts.map((f) => [f.factKey, f]));
    expect(facts.filter((f) => f.factKey === "contact.phone")).toHaveLength(1);
    expect(byKey["contact.phone"]).toMatchObject({ method: "structured_data", content: { normalized: "+966110001111" } });
    // The deterministic "30 SAR" beats the AI's "35 SAR" for the same item on the same source.
    expect(byKey[offeringKey("Burger")]).toMatchObject({ method: "deterministic", content: { normalized: { amount: "30.00" } }, critical: true });
    expect(byKey["policy.refund"]).toMatchObject({ method: "ai", confidence: 60, critical: true });
    expect(byKey["identity.about"]).toMatchObject({ method: "inferred" });
    expect(byKey["identity.about"].confidence).toBeLessThanOrEqual(50);
  });

  it("builds valid fact keys even for non-Latin names", () => {
    expect(offeringKey("قهوة عربية")).toMatch(/^offering:[0-9a-f]{8}$/);
    expect(offeringKey("Spanish Latte")).toMatch(/^offering:spanish-latte-[0-9a-f]{8}$/);
  });
});

describe("computeReadiness", () => {
  const base = { openConflictKeys: [], activeProducts: 0, pricedProducts: 0, branchesWithHours: 0, branchesWithPhone: 0 };

  it("is zero for an empty brain and grows with real, confirmed data", () => {
    expect(computeReadiness({ ...base, facts: [] }).score).toBe(0);
    const found = computeReadiness({ ...base, facts: [{ fact_key: "hours.regular", entry_type: "hours", status: "pending_review" }] });
    const confirmed = computeReadiness({ ...base, facts: [{ fact_key: "hours.regular", entry_type: "hours", status: "approved" }] });
    expect(found.score).toBe(8); // 15 × ½, rounded
    expect(confirmed.score).toBe(15);
  });

  it("gives no credit to an area under conflict and lists it first", () => {
    const r = computeReadiness({
      ...base,
      facts: [{ fact_key: "hours.regular", entry_type: "hours", status: "pending_review" }],
      openConflictKeys: ["hours.regular"],
    });
    expect(r.areas.find((a) => a.key === "hours")?.state).toBe("conflict");
    expect(r.nextSteps[0]).toMatch(/correct opening hours/);
  });

  it("counts the real catalog and branches", () => {
    const r = computeReadiness({ ...base, facts: [], activeProducts: 3, pricedProducts: 3, branchesWithHours: 1, branchesWithPhone: 1 });
    expect(r.score).toBe(20 + 10 + 15 + 15);
  });
});

describe("aiGap", () => {
  const x = (html: string) => extractFromHtml(html, "https://x.sa/");
  it("asks AI only where rules left a gap", () => {
    expect(aiGap("offerings", x("<li>Tea 1 SAR</li><li>Cake 2 SAR</li>"), 5)).toBe(false);
    expect(aiGap("offerings", x("<p>Our menu changes daily</p>"), 5)).toBe(true);
    expect(aiGap("policies", x("<p>Refunds…</p>"), 5)).toBe(true);
    expect(aiGap("contact", x("<p>x</p>"), 5)).toBe(false);
    expect(aiGap("home", x("<p>x</p>"), 5)).toBe(false);
    expect(aiGap("home", x("<p>x</p>"), 1)).toBe(true);
  });
});
