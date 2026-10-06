import { describe, expect, it } from "vitest";

import { localePath } from "@/lib/site/locale-path";
import { RESERVED_SLUGS } from "@/lib/reserved-slugs";
import { resolveConsolePath } from "@/lib/console-routing";
import { SITE_PAGES } from "@/lib/site/config";
import { annualSavingsPercent, announcedTrialDays, bestAnnualSaving, featureLines, pickText, planFamilies, type PublicPlan } from "@/lib/site/pricing";
import { socialLinks } from "@/lib/site/social";

const plan = (over: Partial<PublicPlan>): PublicPlan => ({
  key: "starter",
  family: "starter",
  name: { en: "Starter", ar: "أساسي", fr: "Débutant" },
  description: { en: "Perfect for small businesses" },
  features: { en: "AI Agent 24/7\n\nQR ordering\n" },
  price_minor: 7900,
  currency: "USD",
  exponent: 2,
  billing_interval: "month",
  trial_days: 7,
  conversation_limit: 1000,
  max_branches: null,
  is_popular: false,
  sort_order: 1,
  ...over,
});

const plans = [
  plan({}),
  plan({ key: "starter_annual", billing_interval: "year", price_minor: 79000, conversation_limit: 12000 }),
  plan({ key: "growth", family: "growth", price_minor: 14900, sort_order: 2, is_popular: true }),
  plan({ key: "growth_annual", family: "growth", billing_interval: "year", price_minor: 149000, sort_order: 2, is_popular: true }),
  plan({ key: "pro", family: "pro", price_minor: 24900, sort_order: 3 }),
];

describe("pricing from Super Admin's plans", () => {
  it("one card per family, in Super Admin's order, with its monthly and annual versions", () => {
    const families = planFamilies(plans);
    expect(families.map((f) => f.family)).toEqual(["starter", "growth", "pro"]);
    expect(families[1].monthly?.key).toBe("growth");
    expect(families[1].annual?.key).toBe("growth_annual");
    expect(families[2].annual).toBeNull();
  });

  it("an annual plan at 10 months' price saves 17%", () => {
    const [starter] = planFamilies(plans);
    expect(annualSavingsPercent(starter.monthly, starter.annual)).toBe(17);
    expect(bestAnnualSaving(planFamilies(plans))).toBe(17);
    expect(annualSavingsPercent(plan({}), plan({ billing_interval: "year", price_minor: 7900 * 12 }))).toBeNull();
  });

  it("the trial length the website announces comes from the plans", () => {
    expect(announcedTrialDays(plans)).toBe(7);
    expect(announcedTrialDays([plan({ trial_days: 0 })])).toBeNull();
  });

  it("texts in the visitor's language, else English; features one per line", () => {
    expect(pickText(plans[0].name, "ar")).toBe("أساسي");
    expect(pickText(plans[0].description, "fr")).toBe("Perfect for small businesses");
    expect(featureLines(plans[0], "en")).toEqual(["AI Agent 24/7", "QR ordering"]);
  });
});

describe("the public site's pages and links", () => {
  it("are never taken as a business's slug", () => {
    for (const page of SITE_PAGES) {
      expect(RESERVED_SLUGS.has(page)).toBe(true);
      expect(resolveConsolePath(`/${page}`)).toEqual({ kind: "site" });
    }
  });

  it("switching language keeps the page", () => {
    expect(localePath("/", "ar")).toBe("/ar");
    expect(localePath("/en/pricing", "fr")).toBe("/fr/pricing");
    expect(localePath("/en", "ar")).toBe("/ar");
  });

  it("only https social links are shown", () => {
    expect(socialLinks({ facebook: "https://facebook.com/x", x: "javascript:alert(1)", instagram: "" })).toEqual([{ network: "facebook", url: "https://facebook.com/x" }]);
  });
});
