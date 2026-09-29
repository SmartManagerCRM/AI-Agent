import { describe, expect, it } from "vitest";

import { formatMessage } from "@/components/agent-public/agent-i18n";
import { categoryIcon, findMentionedProducts, pickText } from "@/components/agent-public/agent-model";
import ar from "../../messages/ar.json";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const messages = { en, ar, fr };

const products: { id: string; name: Record<string, string> }[] = [
  { id: "latte", name: { en: "Latte", ar: "لاتيه" } },
  { id: "spanish", name: { en: "Spanish Latte", fr: "Latte espagnol" } },
  { id: "tea", name: { en: "Tea" } },
  { id: "cake", name: { en: "Pistachio Cake", ar: "كيكة الفستق" } },
];

describe("findMentionedProducts", () => {
  it("returns the products a reply names, in reply order", () => {
    const hits = findMentionedProducts("Try our Pistachio Cake with a Latte.", products);
    expect(hits.map((p) => p.id)).toEqual(["cake", "latte"]);
  });

  it("prefers the longer name when one product's name contains another's", () => {
    const hits = findMentionedProducts("The Spanish Latte is our best seller.", products);
    expect(hits.map((p) => p.id)).toEqual(["spanish"]);
  });

  it("matches whole words only, case-insensitively", () => {
    expect(findMentionedProducts("A great steak tonight", products)).toEqual([]);
    expect(findMentionedProducts("tea or coffee?", products).map((p) => p.id)).toEqual(["tea"]);
  });

  it("matches a product by any of its localized names", () => {
    expect(findMentionedProducts("جرّب كيكة الفستق اليوم", products).map((p) => p.id)).toEqual(["cake"]);
    expect(findMentionedProducts("Le Latte espagnol est parfait.", products).map((p) => p.id)).toEqual(["spanish"]);
  });

  it("never invents products and respects the limit", () => {
    expect(findMentionedProducts("We have nothing like that.", products)).toEqual([]);
    expect(findMentionedProducts("Latte, Tea, Pistachio Cake", products, 2)).toHaveLength(2);
  });
});

describe("pickText", () => {
  it("falls back from the UI locale to the business default, then to any value", () => {
    expect(pickText({ en: "Coffee", ar: "قهوة" }, "ar", "en")).toBe("قهوة");
    expect(pickText({ en: "Coffee" }, "fr", "en")).toBe("Coffee");
    expect(pickText({ ar: "قهوة" }, "fr", "en")).toBe("قهوة");
    expect(pickText(null, "en", "en")).toBe("");
  });
});

describe("categoryIcon", () => {
  it("maps category names in any language, and returns null rather than guessing", () => {
    expect(categoryIcon({ en: "Desserts" })).toBe("🍰");
    expect(categoryIcon({ ar: "لابتوبات" })).toBe("💻");
    expect(categoryIcon({ fr: "Boissons" })).toBe("🥤");
    expect(categoryIcon({ en: "Seasonal specials" })).toBeNull();
  });
});

describe("formatMessage (Agent translations)", () => {
  it("fills placeholders and picks plural forms per locale", () => {
    expect(formatMessage("I'm {name}", { name: "Nest AI" }, "en")).toBe("I'm Nest AI");
    const count = "{count, plural, =0 {No items} one {# item} other {# items}}";
    expect(formatMessage(count, { count: 0 }, "en")).toBe("No items");
    expect(formatMessage(count, { count: 1 }, "en")).toBe("1 item");
    expect(formatMessage(count, { count: 12 }, "en")).toBe("12 items");
    const ar = "{count, plural, one {منتج واحد} two {منتجان} few {# منتجات} many {# منتجاً} other {# منتج}}";
    expect(formatMessage(ar, { count: 2 }, "ar")).toBe("منتجان");
    expect(formatMessage(ar, { count: 3 }, "ar")).toMatch(/منتجات$/);
    expect(formatMessage(ar, { count: 11 }, "ar")).toMatch(/منتجاً$/);
  });

  it("formats every Agent message in every language without leftover syntax", () => {
    const values = { name: "X", business: "X", count: 3, minutes: 30, label: "7", category: "X", code: "X", price: "X", branch: "X", service: "X", number: 1001 };
    for (const locale of ["en", "ar", "fr"] as const) {
      const walk = (node: unknown, path: string) => {
        if (typeof node === "string") {
          const out = formatMessage(node, values, locale);
          expect(out, `${locale}:${path}`).not.toMatch(/[{}]/);
        } else if (node && typeof node === "object") {
          for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
        }
      };
      walk(messages[locale].agent, "agent");
    }
  });
});
