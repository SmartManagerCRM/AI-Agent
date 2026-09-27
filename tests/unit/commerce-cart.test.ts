import { describe, expect, it } from "vitest";

import { matchProductByName } from "@/server/commerce/cart";

const products: { id: string; name: Record<string, string>; price_minor: number }[] = [
  { id: "1", name: { en: "Latte", ar: "لاتيه" }, price_minor: 1500 },
  { id: "2", name: { en: "Spanish Latte", ar: "لاتيه إسباني" }, price_minor: 1800 },
  { id: "3", name: { en: "Croissant" }, price_minor: 900 },
];

describe("matchProductByName", () => {
  it("returns null for an empty query", () => {
    expect(matchProductByName(products, "en", "  ")).toBeNull();
  });

  it("matches an exact name case-insensitively", () => {
    expect(matchProductByName(products, "en", "latte")?.id).toBe("1");
    expect(matchProductByName(products, "en", "LATTE")?.id).toBe("1");
  });

  it("prefers the exact match over a substring match", () => {
    // "Latte" is an exact match for product 1; without this, substring
    // matching alone could just as easily land on "Spanish Latte" first.
    expect(matchProductByName(products, "en", "Latte")?.id).toBe("1");
  });

  it("matches when the query is a substring of the product name", () => {
    expect(matchProductByName(products, "en", "spanish")?.id).toBe("2");
  });

  it("matches when the product name is a substring of the query", () => {
    expect(matchProductByName(products, "en", "one croissant please")?.id).toBe("3");
  });

  it("falls back to another locale's name when the requested locale is missing", () => {
    expect(matchProductByName(products, "fr", "croissant")?.id).toBe("3");
  });

  it("returns null when nothing matches", () => {
    expect(matchProductByName(products, "en", "pizza")).toBeNull();
  });

  it("matches Arabic names directly", () => {
    expect(matchProductByName(products, "ar", "لاتيه إسباني")?.id).toBe("2");
  });
});
