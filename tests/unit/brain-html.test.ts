import { describe, expect, it } from "vitest";

import { extractPage, findBusinessJsonLd } from "@/server/brain/html";

describe("extractPage", () => {
  it("extracts title, meta description, JSON-LD, text and same-site links", () => {
    const html = `
      <html>
        <head>
          <title>Roasters Café</title>
          <meta name="description" content="Specialty coffee in Riyadh.">
          <script type="application/ld+json">
            {"@type": "CafeOrCoffeeShop", "telephone": "+966500000000"}
          </script>
        </head>
        <body>
          <script>alert('should not appear in text')</script>
          <p>Welcome to Roasters. We serve espresso and pastries.</p>
          <a href="/menu">Menu</a>
          <a href="https://external.example.com/x">External</a>
        </body>
      </html>`;
    const page = extractPage(html, "https://roasters.example.com/");

    expect(page.title).toBe("Roasters Café");
    expect(page.metaDescription).toBe("Specialty coffee in Riyadh.");
    expect(page.jsonLd).toHaveLength(1);
    expect(page.text).toContain("Welcome to Roasters");
    expect(page.text).not.toContain("should not appear");
    expect(page.links).toContain("https://roasters.example.com/menu");
    expect(page.links).toContain("https://external.example.com/x");
  });

  it("never throws on malformed JSON-LD", () => {
    const html = `<script type="application/ld+json">{not json}</script>`;
    expect(() => extractPage(html, "https://example.com")).not.toThrow();
  });

  it("returns no links when the base URL cannot be parsed", () => {
    const page = extractPage(`<a href="/x">x</a>`, "not-a-url");
    expect(page.links).toEqual([]);
  });
});

describe("findBusinessJsonLd", () => {
  it("finds a LocalBusiness-shaped entry among unrelated JSON-LD", () => {
    const found = findBusinessJsonLd([{ "@type": "BreadcrumbList" }, { "@type": "Restaurant", name: "Roasters" }]);
    expect(found?.name).toBe("Roasters");
  });

  it("returns null when nothing matches", () => {
    expect(findBusinessJsonLd([{ "@type": "BreadcrumbList" }])).toBeNull();
  });

  it("matches when @type is an array", () => {
    const found = findBusinessJsonLd([{ "@type": ["Thing", "LocalBusiness"] }]);
    expect(found).not.toBeNull();
  });
});
