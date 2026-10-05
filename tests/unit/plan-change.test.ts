import { describe, expect, it } from "vitest";

import { planChangeDirection, type PlanForChange } from "@/lib/billing/plan-change";

// The production catalogue: Starter / Growth / Pro, monthly and annual (10× the monthly price).
const PLANS: PlanForChange[] = [
  { key: "starter", price_minor: 7900, currency: "USD", billing_interval: "month", plan_family: "starter" },
  { key: "starter_annual", price_minor: 79000, currency: "USD", billing_interval: "year", plan_family: "starter" },
  { key: "growth", price_minor: 14900, currency: "USD", billing_interval: "month", plan_family: "growth" },
  { key: "growth_annual", price_minor: 149000, currency: "USD", billing_interval: "year", plan_family: "growth" },
  { key: "pro", price_minor: 24900, currency: "USD", billing_interval: "month", plan_family: "pro" },
  { key: "pro_annual", price_minor: 249000, currency: "USD", billing_interval: "year", plan_family: "pro" },
];
const dir = (from: string, to: string) => planChangeDirection(from, to, PLANS);

describe("planChangeDirection (same rule as app.plan_change_direction)", () => {
  it("a higher tier is an upgrade, a lower one a downgrade", () => {
    expect(dir("starter", "growth")).toBe("upgrade");
    expect(dir("growth", "pro")).toBe("upgrade");
    expect(dir("pro", "starter")).toBe("downgrade");
    expect(dir("growth_annual", "pro_annual")).toBe("upgrade");
    expect(dir("pro_annual", "growth_annual")).toBe("downgrade");
  });

  it("monthly → annual of the same tier is an upgrade, though cheaper per month", () => {
    expect(dir("growth", "growth_annual")).toBe("upgrade");
    expect(dir("starter", "pro_annual")).toBe("upgrade");
  });

  it("annual → monthly is always a downgrade (at the end of the paid year)", () => {
    expect(dir("growth_annual", "growth")).toBe("downgrade");
    expect(dir("starter_annual", "pro")).toBe("downgrade");
  });

  it("monthly → a lower annual tier is a downgrade", () => {
    expect(dir("pro", "starter_annual")).toBe("downgrade");
  });

  it("the same plan; unknown plans; plans without a family", () => {
    expect(dir("growth", "growth")).toBe("same");
    expect(dir("growth", "gone")).toBe("upgrade");
    const loose: PlanForChange[] = [
      { key: "a", price_minor: 9900, currency: "USD", billing_interval: "month" },
      { key: "b", price_minor: 60000, currency: "USD", billing_interval: "year" },
    ];
    expect(planChangeDirection("a", "b", loose)).toBe("downgrade");
    expect(planChangeDirection("b", "a", loose)).toBe("downgrade");
  });
});
