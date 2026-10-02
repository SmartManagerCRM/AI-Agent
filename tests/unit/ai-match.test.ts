import { describe, expect, it } from "vitest";

import { matchDeterministic, type BrainSnapshot } from "@/server/ai/deterministic/match";

const baseSnapshot: BrainSnapshot = {
  locale: "en",
  assistantName: "Aria",
  greeting: null,
  currency: "SAR",
  currencyExponent: 2,
  products: [{ name: "Latte", priceMinor: 1500 }],
  defaultBranch: {
    name: "Roasters Downtown",
    phone: "+966500000000",
    openingHours: { mon: [{ open: "08:00", close: "22:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  },
  notes: { delivery_info: "We deliver within 5km.", pickup_info: "Pickup at the counter." },
  faqs: [{ entryKey: "do-you-have-wifi", answer: "Yes, free wifi is available." }],
  returningCustomer: null,
};

describe("matchDeterministic", () => {
  it("returns null for an empty message", () => {
    expect(matchDeterministic("   ", baseSnapshot)).toBeNull();
  });

  it("matches a short greeting", () => {
    const result = matchDeterministic("hello", baseSnapshot);
    expect(result?.rule).toBe("greeting");
    expect(result?.reply).toContain("Aria");
  });

  it("does not treat a long message containing a greeting word as a greeting", () => {
    const result = matchDeterministic("hello, do you have a table for six people tonight around 8pm please", baseSnapshot);
    expect(result?.rule).not.toBe("greeting");
  });

  it("matches thanks", () => {
    expect(matchDeterministic("thanks a lot!", baseSnapshot)?.rule).toBe("thanks");
  });

  it("matches an opening-hours question and reports today's hours", () => {
    const result = matchDeterministic("what are your hours?", baseSnapshot);
    expect(result?.rule).toBe("opening_hours");
    expect(result?.reply).toContain("Roasters Downtown");
  });

  it("matches a delivery question against a business_brain delivery_info note", () => {
    const result = matchDeterministic("do you deliver?", baseSnapshot);
    expect(result).toEqual({ rule: "delivery_info", reply: "We deliver within 5km." });
  });

  it("matches a product-price question by name", () => {
    const result = matchDeterministic("how much is a latte?", baseSnapshot);
    expect(result).toEqual({ rule: "product_price", reply: "Latte is 15.00 SAR." });
  });

  it("matches an FAQ by its keyword-bearing key", () => {
    const result = matchDeterministic("do you have wifi here", baseSnapshot);
    expect(result).toEqual({ rule: "faq:do-you-have-wifi", reply: "Yes, free wifi is available." });
  });

  it("returns null when nothing matches, deferring to AI", () => {
    expect(matchDeterministic("can you recommend something spicy for two people under 60 SAR?", baseSnapshot)).toBeNull();
  });

  it("does not match delivery when there is no delivery_info note", () => {
    const snapshot: BrainSnapshot = { ...baseSnapshot, notes: {} };
    expect(matchDeterministic("do you deliver?", snapshot)).toBeNull();
  });

  it("answers in the customer's language: the one they write in, else the conversation's", () => {
    const ar: BrainSnapshot = { ...baseSnapshot, locale: "ar", defaultBranch: { ...baseSnapshot.defaultBranch!, openingHours: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } } };
    expect(matchDeterministic("ساعات العمل", ar)?.reply).toBe("Roasters Downtown مغلق اليوم.");
    expect(matchDeterministic("شكرا", ar)?.reply).toBe("على الرحب والسعة!");
    expect(matchDeterministic("مرحبا", ar)?.reply).toContain("أنا مساعدك Aria");
    // English typed in the Arabic Agent gets English.
    expect(matchDeterministic("thanks", ar)?.reply).toBe("You're welcome!");
    expect(matchDeterministic("merci", { ...baseSnapshot, locale: "fr" })?.reply).toBe("Avec plaisir !");
    expect(matchDeterministic("combien est le latte", { ...baseSnapshot, locale: "fr" })?.reply).toBe("Latte coûte 15.00 SAR.");
    // A greeting the business saved is used as written, in any language.
    expect(matchDeterministic("مرحبا", { ...ar, greeting: "Welcome!" })?.reply).toBe("Welcome!");
  });
});
