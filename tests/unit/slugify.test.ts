import { describe, expect, it } from "vitest";

import { slugify } from "@/lib/slugify";

describe("slugify", () => {
  it("lowercases a plain name", () => {
    expect(slugify("SmartManager")).toBe("smartmanager");
  });

  it("converts spaces to hyphens", () => {
    expect(slugify("Millennium Leaders")).toBe("millennium-leaders");
  });

  it("strips punctuation and collapses runs of separators", () => {
    expect(slugify("Millennium Leaders Engineering & Business Solutions")).toBe(
      "millennium-leaders-engineering-business-solution",
    );
  });

  it("strips accents", () => {
    expect(slugify("Roasters Café")).toBe("roasters-cafe");
    expect(slugify("Café Roasters")).toBe("cafe-roasters");
  });

  it("collapses repeated separators and trims leading/trailing hyphens", () => {
    expect(slugify("  --Foo   Bar--  ")).toBe("foo-bar");
  });

  it("enforces the server's max length (48) without a trailing hyphen", () => {
    const slug = slugify("a".repeat(60));
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("produces an empty string for non-Latin scripts rather than garbage", () => {
    expect(slugify("مطعم الأصالة")).toBe("");
  });
});
