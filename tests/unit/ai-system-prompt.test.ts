import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "@/server/ai/system-prompt";
import type { BrainSnapshot } from "@/server/ai/deterministic/match";

const baseSnapshot: BrainSnapshot = {
  locale: "en",
  assistantName: "Aria",
  greeting: null,
  currency: "SAR",
  currencyExponent: 2,
  products: [
    { name: "Latte", priceMinor: 1500 },
    { name: "Spanish Latte", priceMinor: 1800 },
  ],
  defaultBranch: {
    name: "Roasters Downtown",
    phone: "+966500000000",
    openingHours: {},
  },
  notes: { about: "A specialty coffee shop.", delivery_info: "We deliver within 5km." },
  faqs: [],
};

describe("buildSystemPrompt", () => {
  it("includes the assistant name and never claims order/payment capability", () => {
    const prompt = buildSystemPrompt(baseSnapshot);
    expect(prompt).toContain("Aria");
    expect(prompt).toContain("never invent products, prices, availability, or policies");
    expect(prompt).toContain("never assert it from memory");
  });

  it("includes product names and correctly formatted prices", () => {
    const prompt = buildSystemPrompt(baseSnapshot);
    expect(prompt).toContain("Latte — 15.00 SAR");
    expect(prompt).toContain("Spanish Latte — 18.00 SAR");
  });

  it("includes business notes only when present", () => {
    const prompt = buildSystemPrompt(baseSnapshot);
    expect(prompt).toContain("A specialty coffee shop.");
    expect(prompt).toContain("We deliver within 5km.");
    expect(prompt).not.toContain("Pickup:");
    expect(prompt).not.toContain("Payment methods:");
  });

  it("caps the product list and notes how many more exist", () => {
    const manyProducts = Array.from({ length: 45 }, (_, i) => ({ name: `Item ${i}`, priceMinor: 1000 }));
    const prompt = buildSystemPrompt({ ...baseSnapshot, products: manyProducts });
    expect(prompt).toContain("Item 39");
    expect(prompt).not.toContain("Item 40");
    expect(prompt).toContain("5 more products exist");
  });

  it("omits the products line entirely when there are none", () => {
    const prompt = buildSystemPrompt({ ...baseSnapshot, products: [] });
    expect(prompt).not.toContain("Available products");
  });
});
