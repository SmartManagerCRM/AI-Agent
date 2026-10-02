import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractItemsFromHtml,
  extractItemsFromLines,
  extractLinesFromPdf,
  parseDuration,
  prepareCatalogItems,
} from "@/server/catalog/import-extract";

const fixture = (name: string) => readFileSync(path.join(process.cwd(), "tests/fixtures/catalog", name));
const prices = (items: { name: string; priceMajor: number | null }[]) =>
  Object.fromEntries(items.map((i) => [i.name, i.priceMajor]));

describe("catalog file import — HTML (no AI)", () => {
  it("menu cards: name, description and footer in separate tags, an \"Add\" button — never glued together", () => {
    // The layout that produced "Drinks CappuccinoEspresso with steamed milk and foam Add" and an item called "Add".
    const raw = extractItemsFromHtml(fixture("card-menu.html").toString("utf8"));
    const { items } = prepareCatalogItems(raw, { tenantCurrency: "SAR", kind: "product", existingNames: new Set() });
    expect(items.map((i) => [i.name, i.priceMajor, i.category, i.description])).toEqual([
      ["Cappuccino", 15, "Drinks", "Espresso with steamed milk and foam"],
      ["Fresh Lemonade", 13, "Drinks", "Refreshing homemade lemonade"],
      ["Classic Hummus", 18, "Starters", "Chickpeas, tahini, lemon and olive oil"],
      ["Crispy Chicken Wings", 26, "Starters", "Golden wings with house seasoning"],
      ["Classic Cheeseburger", 32, "Main Courses", "Beef patty, cheddar, lettuce, tomato and house sauce"],
    ]);
  });

  it("each card keeps its own photo: plain, lazy-loaded, srcset (largest), background; never the page logo", () => {
    const raw = extractItemsFromHtml(fixture("card-menu.html").toString("utf8"));
    const photo = Object.fromEntries(raw.map((i) => [i.name, i.imageUrl ?? null]));
    expect(photo).toMatchObject({
      Cappuccino: "https://cdn.example.com/menu/cappuccino.jpg",
      "Fresh Lemonade": "https://cdn.example.com/menu/lemonade.webp",
      "Classic Hummus": "https://cdn.example.com/menu/hummus-800.jpg",
      "Crispy Chicken Wings": "https://cdn.example.com/menu/wings.jpg",
      "Classic Cheeseburger": null,
    });
    // ...and the photo survives into what gets added.
    const { items } = prepareCatalogItems(raw, { tenantCurrency: "SAR", kind: "product", existingNames: new Set() });
    expect(items.find((i) => i.name === "Cappuccino")?.imageUrl).toBe("https://cdn.example.com/menu/cappuccino.jpg");
  });

  it("photos by relative path: found through the saved page's address; without one they can't be located", () => {
    const card = (head: string) =>
      `<html><head>${head}</head><body><ul><li class="item"><img src="img/latte.jpg" width="300"><h3>Latte</h3><span>SAR 18</span></li></ul></body></html>`;
    expect(extractItemsFromHtml(card('<link rel="canonical" href="https://cafe.example.com/menu/">'))[0].imageUrl).toBe(
      "https://cafe.example.com/menu/img/latte.jpg",
    );
    expect(extractItemsFromHtml(card(""))[0].imageUrl).toBeNull();
    // Inline pictures in a saved page work without any address.
    const inline = `<ul><li class="item"><img src="data:image/png;base64,iVBORw0KGgo="><h3>Latte</h3><span>SAR 18</span></li></ul>`;
    expect(extractItemsFromHtml(inline)[0].imageUrl).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("structured data and embedded catalog JSON carry their image too; icons and SVGs never count", () => {
    const ld = `<script type="application/ld+json">${JSON.stringify({
      "@type": "Menu",
      hasMenuSection: [{ "@type": "MenuSection", name: "Coffee", hasMenuItem: [
        { "@type": "MenuItem", name: "Mocha", image: { "@type": "ImageObject", url: "https://cdn.example.com/mocha.jpg" }, offers: { price: "20", priceCurrency: "SAR" } },
        { "@type": "MenuItem", name: "Tea", image: "https://cdn.example.com/icons/tea.svg", offers: { price: "8", priceCurrency: "SAR" } },
      ] }],
    })}</script>`;
    const items = extractItemsFromHtml(ld);
    expect(items.find((i) => i.name === "Mocha")?.imageUrl).toBe("https://cdn.example.com/mocha.jpg");
    expect(items.find((i) => i.name === "Tea")?.imageUrl).toBeNull();
  });

  it("menu cards without class names: the heading is the name, buttons and the section label are dropped", () => {
    const html = `<section><h2>Desserts</h2><div class="grid">
      <div class="card"><span>Desserts</span><div><h4>Cheesecake</h4><p>Classic baked cheesecake</p></div><div><span>SAR 21.00</span><button>Add to cart</button></div></div>
      <div class="card"><span>Desserts</span><div><h4>Chocolate Brownie</h4><p>Warm brownie with vanilla ice cream</p></div><div><span>SAR 20.00</span><a role="button">Add</a></div></div>
    </div></section>`;
    const { items } = prepareCatalogItems(extractItemsFromHtml(html), { tenantCurrency: "SAR", kind: "product", existingNames: new Set() });
    expect(items.map((i) => [i.name, i.priceMajor, i.category, i.description])).toEqual([
      ["Cheesecake", 21, "Desserts", "Classic baked cheesecake"],
      ["Chocolate Brownie", 20, "Desserts", "Warm brownie with vanilla ice cream"],
    ]);
  });

  it("reads a café menu laid out as a table, a list and plain lines", () => {
    const raw = extractItemsFromHtml(fixture("cafe-menu.html").toString("utf8"));
    const { items, skipped } = prepareCatalogItems(raw, {
      tenantCurrency: "SAR",
      kind: "product",
      existingNames: new Set(),
    });
    expect(prices(items)).toMatchObject({
      Espresso: 12,
      "Spanish Latte": 18,
      "Flat White": 17.5,
      "Iced Latte": 19,
      "Fresh Orange Juice": 15,
      "كركديه بارد": 14,
      "Pistachio Cake": 25,
      "San Sebastian Cheesecake": 28,
    });
    expect(items).toHaveLength(8);
    // Headings and footer text are never products; the unpriced tart isn't guessed.
    expect(items.map((i) => i.name)).not.toContain("Seasonal tart (ask our staff)");
    expect(items.every((i) => !i.sourcePrice)).toBe(true);
    expect(skipped.duplicates).toBe(0);
  });

  it("keeps the menu's sections as categories", () => {
    const raw = extractItemsFromHtml(fixture("cafe-menu.html").toString("utf8"));
    const { items } = prepareCatalogItems(raw, { tenantCurrency: "SAR", kind: "product", existingNames: new Set() });
    expect(items.find((i) => i.name === "Pistachio Cake")?.category).toBe("Desserts");
    expect(items.find((i) => i.name === "Iced Latte")?.category).toBe("Cold Drinks");
  });

  it("skips what is already in the catalog; a price in another currency becomes a draft to price, never converted", () => {
    const raw = [
      { name: "Espresso", amount: "12", currency: null, category: null, description: null },
      { name: "Imported Tea", amount: "5.00", currency: "USD", category: null, description: null },
      { name: "Mocha", amount: "20", currency: "SAR", category: null, description: null },
      { name: "Mocha", amount: "20", currency: "SAR", category: null, description: null },
    ];
    const { items, skipped, needsPrice } = prepareCatalogItems(raw, {
      tenantCurrency: "SAR",
      kind: "product",
      existingNames: new Set(["espresso"]),
    });
    expect(items.map((i) => i.name)).toEqual(["Imported Tea", "Mocha"]);
    expect(items[0]).toMatchObject({ priceMajor: null, sourcePrice: { amount: "5.00", currency: "USD" } });
    expect(items[1]).toMatchObject({ priceMajor: 20 });
    expect(items[1].sourcePrice).toBeUndefined();
    expect(skipped).toMatchObject({ duplicates: 2 });
    expect(needsPrice).toBe(1);
  });

  it("services: durations from the text, price optional", () => {
    const raw = extractItemsFromHtml(fixture("salon-services.html").toString("utf8"));
    const { items } = prepareCatalogItems(raw, { tenantCurrency: "SAR", kind: "service", existingNames: new Set() });
    const byName = Object.fromEntries(items.map((i) => [i.name, i]));
    expect(byName["Women's Haircut"]).toMatchObject({ priceMajor: 120, durationMinutes: 45 });
    expect(byName["Gel Pedicure"]).toMatchObject({ priceMajor: 150, durationMinutes: 60 });
    expect(byName["Blow Dry"]).toMatchObject({ durationMinutes: 30 });
  });

  it("parses durations in English, French and Arabic", () => {
    expect(parseDuration("Haircut 45 min")).toBe(45);
    expect(parseDuration("Massage 1.5 hours")).toBe(90);
    expect(parseDuration("Coupe 30 minutes")).toBe(30);
    expect(parseDuration("قص الشعر ٤٥ دقيقة")).toBe(45);
    expect(parseDuration("Shampoo")).toBeNull();
  });
});

describe("catalog file import — PDF (no AI)", () => {
  it("reads a real text PDF line by line", async () => {
    const lines = await extractLinesFromPdf(new Uint8Array(fixture("breakfast-menu.pdf")), 60);
    expect(lines).not.toBeNull();
    const { items } = prepareCatalogItems(extractItemsFromLines(lines!), {
      tenantCurrency: "SAR",
      kind: "product",
      existingNames: new Set(),
    });
    expect(prices(items)).toEqual({
      Shakshuka: 32,
      "Foul Medames": 18,
      "Halloumi Sandwich": 26,
      Kunafa: 24,
      Basbousa: 16,
    });
    expect(items.find((i) => i.name === "Kunafa")?.category).toBe("Sweets");
  });

  it("refuses PDFs over the page limit", async () => {
    expect(await extractLinesFromPdf(new Uint8Array(fixture("breakfast-menu.pdf")), 0)).toBeNull();
  });
});
