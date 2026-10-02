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
    expect(skipped.otherCurrency).toBe(0);
  });

  it("keeps the menu's sections as categories", () => {
    const raw = extractItemsFromHtml(fixture("cafe-menu.html").toString("utf8"));
    const { items } = prepareCatalogItems(raw, { tenantCurrency: "SAR", kind: "product", existingNames: new Set() });
    expect(items.find((i) => i.name === "Pistachio Cake")?.category).toBe("Desserts");
    expect(items.find((i) => i.name === "Iced Latte")?.category).toBe("Cold Drinks");
  });

  it("skips what is already in the catalog and anything priced in another currency", () => {
    const raw = [
      { name: "Espresso", amount: "12", currency: null, category: null, description: null },
      { name: "Imported Tea", amount: "5.00", currency: "USD", category: null, description: null },
      { name: "Mocha", amount: "20", currency: "SAR", category: null, description: null },
      { name: "Mocha", amount: "20", currency: "SAR", category: null, description: null },
    ];
    const { items, skipped } = prepareCatalogItems(raw, {
      tenantCurrency: "SAR",
      kind: "product",
      existingNames: new Set(["espresso"]),
    });
    expect(items.map((i) => i.name)).toEqual(["Mocha"]);
    expect(skipped).toMatchObject({ duplicates: 2, otherCurrency: 1 });
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
