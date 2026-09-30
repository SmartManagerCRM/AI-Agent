import { describe, expect, it } from "vitest";

import { matchCatalog, relevantProducts, type Catalog } from "@/server/ai/deterministic/catalog";

// A Khayal-style bilingual restaurant menu (the shape Business Brain → catalog produces).
const catalog: Catalog = {
  currency: "SAR",
  currencyExponent: 2,
  locale: "en",
  categories: [
    { id: "c-breakfast", names: { en: "Breakfast", ar: "الفطور" } },
    { id: "c-soups", names: { en: "Soups", ar: "الشوربات" } },
    { id: "c-salads", names: { en: "Salads", ar: "السلطات" } },
    { id: "c-empty", names: { en: "Desserts" } },
  ],
  products: [
    { id: "p-shakshuka", names: { en: "Shakshuka", ar: "شكشوكة" }, description: "Eggs in tomato sauce", categoryId: "c-breakfast", priceMinor: 2800 },
    { id: "p-foul", names: { ar: "فول مدمس" }, description: null, categoryId: "c-breakfast", priceMinor: 1500 },
    { id: "p-lentil", names: { en: "Lentil Soup", ar: "شوربة عدس" }, description: "Traditional lentil soup", categoryId: "c-soups", priceMinor: 1800 },
    { id: "p-daily", names: { ar: "شوربة اليوم" }, description: null, categoryId: "c-soups", priceMinor: 1600 },
    { id: "p-fattoush", names: { en: "Fattoush", ar: "فتوش" }, description: null, categoryId: "c-salads", priceMinor: 2000 },
  ],
};

const run = (message: string, recent: string[] = []) => matchCatalog(message, catalog, { recent });

describe("menu discovery (deterministic, no AI)", () => {
  it.each(["What is your menu?", "What food do you have?", "What is your menu for food", "Show me food", "ما هي قائمة الطعام؟", "شنوة عندكم؟", "شنو عندكم من أكل؟", "Qu'avez-vous à la carte ?"])(
    "%s → the real categories with counts and product cards",
    (message) => {
      const m = run(message);
      expect(m?.intent).toBe("menu");
      expect(m?.productIds.length).toBeGreaterThan(0);
      // Only categories that actually have products; never an invented one.
      expect(m?.reply).not.toContain("Desserts");
    },
  );

  it("answers in the customer's language", () => {
    expect(run("ما هي قائمة الطعام؟")?.reply).toContain("هذه قائمتنا");
    expect(run("ما هي قائمة الطعام؟")?.reply).toContain("الفطور (2)");
    expect(run("What food do you have?")?.reply).toContain("Breakfast (2)");
  });
});

describe("product search", () => {
  it("شوربة → the soups, in Arabic, with prices and ids", () => {
    const m = run("شوربة");
    expect(m?.intent).toBe("category");
    expect(m?.productIds).toEqual(["p-lentil", "p-daily"]);
    expect(m?.reply).toContain("شوربة عدس — 18.00 SAR");
  });

  it.each(["عندكم شوربة؟", "Do you have soup?", "Show me soups", "soup"])("%s → soups", (message) => {
    expect(run(message)?.productIds).toEqual(["p-lentil", "p-daily"]);
  });

  it("Show me breakfast → the breakfast category", () => {
    const m = run("Show me breakfast");
    expect(m?.intent).toBe("category");
    expect(m?.productIds).toEqual(["p-shakshuka", "p-foul"]);
  });

  it("finds a single product by name in either language", () => {
    expect(run("fattoush")?.productIds).toEqual(["p-fattoush"]);
    expect(run("فتوش")?.productIds).toEqual(["p-fattoush"]);
    expect(run("lentil")?.productIds).toEqual(["p-lentil"]);
  });
});

describe("prices come from the catalog, never from a model", () => {
  it("How much is the fattoush?", () => {
    expect(run("How much is the fattoush?")?.reply).toBe("Fattoush is 20.00 SAR.");
  });

  it("How much is it? → the product last mentioned in this conversation", () => {
    const m = run("How much is it?", ["Here's what I found for “lentil”:\n• Lentil Soup — 18.00 SAR"]);
    expect(m?.intent).toBe("price");
    expect(m?.productIds).toEqual(["p-lentil"]);
    expect(m?.reply).toBe("Lentil Soup is 18.00 SAR.");
    expect(run("How much is it?")).toBeNull();
    // Several products in the last reply: "it" is ambiguous — never guessed.
    expect(run("How much is it?", ["• Lentil Soup — 18.00 SAR\n• شوربة اليوم — 16.00 SAR"])).toBeNull();
  });
});

describe("unknown products are not hallucinated", () => {
  it.each(["Do you have pizza?", "pizza", "عندكم بيتزا؟"])("%s → not found, with what we do have", (message) => {
    const m = run(message);
    expect(m?.intent).toBe("not_found");
    expect(m?.productIds).toEqual([]);
  });

  it("leaves everything else to the rest of the Agent", () => {
    for (const message of [
      "Which soup would you recommend if I want something light?",
      "What is your phone number?",
      "I'd like to request a quote.",
      "My order was late yesterday",
      "I want to talk to someone",
      "ok",
      "السلام عليكم",
    ]) {
      expect(run(message), message).toBeNull();
    }
  });

  it("an empty catalog says so honestly", () => {
    const m = matchCatalog("What is your menu?", { ...catalog, products: [], categories: [] });
    expect(m?.intent).toBe("menu_empty");
    expect(m?.productIds).toEqual([]);
  });
});

describe("relevantProducts — the only products an AI call sees", () => {
  it("sends just the soups for a soup recommendation", () => {
    expect(relevantProducts("Which soup would you recommend if I want something light?", catalog).map((p) => p.id)).toEqual(["p-lentil", "p-daily"]);
  });
});

describe("cross-language: Arabic-only menu, English/French questions", () => {
  const arabicOnly: Catalog = {
    ...catalog,
    categories: [
      { id: "b", names: { ar: "الفطور" } },
      { id: "s", names: { ar: "الشوربات" } },
    ],
    products: [
      { id: "shak", names: { ar: "شكشوكة" }, description: null, categoryId: "b", priceMinor: 2800 },
      { id: "lentil", names: { ar: "شوربة عدس" }, description: null, categoryId: "s", priceMinor: 1800 },
      { id: "daily", names: { ar: "شوربة اليوم" }, description: null, categoryId: "s", priceMinor: 1600 },
    ],
  };
  const ask = (m: string, recent: string[] = []) => matchCatalog(m, arabicOnly, { recent });

  it("Show me breakfast → الفطور", () => {
    expect(ask("Show me breakfast")?.productIds).toEqual(["shak"]);
  });

  it("soups / soupe → الشوربات", () => {
    expect(ask("Do you have soup?")?.productIds).toEqual(["lentil", "daily"]);
    expect(ask("Avez-vous de la soupe ?")?.productIds).toEqual(["lentil", "daily"]);
  });

  it("lentil soup → only شوربة عدس, then “how much is it?” prices exactly that one", () => {
    const found = ask("Show me lentil soup");
    expect(found?.productIds).toEqual(["lentil"]);
    expect(ask("How much is it?", [found!.reply])?.reply).toBe("\u2068شوربة عدس\u2069 is 18.00 SAR.");
  });

  it("quotes the customer's own words when nothing matches", () => {
    expect(ask("Do you have pizza?")?.reply).toContain("“pizza”");
  });
});

