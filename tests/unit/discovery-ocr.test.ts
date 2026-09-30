import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { prepareImage, probeImageSize } from "@/server/brain/discovery/image-prep";
import { parseMenuText, ocrVerdict } from "@/server/brain/discovery/menu-text";
import { withOcrEngine } from "@/server/brain/discovery/ocr";

const fixture = (name: string) => readFile(path.join(process.cwd(), "tests/fixtures/menus", name));

describe("menu text parsing", () => {
  it("reads bare menu prices, applying a currency only when the menu states it", () => {
    const withNote = parseMenuText(["BREAKFAST", "All prices in SAR", "Shakshuka 32", "Foul Medames ..... 18", "Eggs Benedict 38"]);
    expect(withNote.menuCurrency).toBe("SAR");
    expect(withNote.items).toEqual([
      { name: "Shakshuka", amount: "32.00", currency: "SAR", category: "BREAKFAST", currencySource: "menu" },
      { name: "Foul Medames", amount: "18.00", currency: "SAR", category: "BREAKFAST", currencySource: "menu" },
      { name: "Eggs Benedict", amount: "38.00", currency: "SAR", category: "BREAKFAST", currencySource: "menu" },
    ]);
    const noNote = parseMenuText(["Shakshuka 32", "Foul 18"]);
    expect(noNote.items[0]).toMatchObject({ amount: "32", currency: null, currencySource: null });
  });

  it("keeps written currencies and Arabic-Indic digits", () => {
    expect(parseMenuText(["شكشوكة ٣٢ ر.س"]).items[0]).toMatchObject({ name: "شكشوكة", amount: "32.00", currency: "SAR" });
  });
});

describe("OCR (local Tesseract, bundled language data)", () => {
  it("reads a clear English menu well enough to skip vision, and routes an Arabic menu to vision", async () => {
    const [en, ar] = await Promise.all([fixture("breakfast-en.png"), fixture("breakfast-ar.png")]);
    expect(probeImageSize(en)).toMatchObject({ format: "png", width: 800 });
    const results = await withOcrEngine(async (engine) => {
      const out = [];
      for (const img of [en, ar]) {
        const prepared = await prepareImage(img);
        const ocr = await engine.recognize(prepared!.ocr!);
        const parsed = ocr ? parseMenuText(ocr.lines.map((l) => l.text)) : null;
        out.push({ ocr, parsed, verdict: ocrVerdict(ocr, parsed) });
      }
      return out;
    });
    const [enR, arR] = results;
    expect(enR.verdict.sufficient).toBe(true);
    expect(enR.parsed?.items.map((i) => `${i.name}=${i.amount} ${i.currency}`)).toEqual(
      expect.arrayContaining(["Shakshuka=32.00 SAR", "Foul Medames=18.00 SAR", "Eggs Benedict=38.00 SAR", "Pancakes=29.00 SAR"]),
    );
    expect(arR.verdict.sufficient).toBe(false);
  }, 60_000);
});
