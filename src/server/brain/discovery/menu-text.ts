import { cleanName, findPrices, formatAmount, toWesternDigits } from "./extract";
import type { OcrResult } from "./ocr";

/**
 * Turns menu text (OCR output, or a text menu) into items, and decides
 * whether OCR alone is good enough or the image must go to the vision
 * model. Pure.
 *
 * On a menu, prices are often bare numbers ("Shakshuka ...... 32"). A bare
 * number is accepted as a price only in a menu context and keeps
 * `currency: null` unless the same menu states its currency somewhere
 * ("All prices in SAR", "ر.س" next to other prices) — the currency is
 * never assumed from the business's country or settings.
 */
export type MenuTextItem = { name: string; amount: string | null; currency: string | null; category: string | null; currencySource: "written" | "menu" | null };

export type ParsedMenuText = { items: MenuTextItem[]; categories: string[]; lines: number; pricedLines: number; menuCurrency: string | null };

const MENU_CURRENCY_NOTE = /(prices?\s+(are\s+)?in|all\s+prices|الأسعار\s+(بال)?|prix\s+en)\s*([A-Za-z]{3}|ريال|ر\.?\s?س|درهم|دينار)/i;
const BARE_PRICE_END = /^(.*?\p{L}.*?)[\s.…:·_\-–—|]+(\d{1,4}(?:[.,]\d{1,3})?)\s*$/u;
const BARE_PRICE_START = /^\s*(\d{1,4}(?:[.,]\d{1,3})?)[\s.…:·_\-–—|]+(.*\p{L}.*)$/u;

export function parseMenuText(rawLines: string[]): ParsedMenuText {
  const lines = rawLines.map((l) => toWesternDigits(l).replace(/\s+/g, " ").trim()).filter(Boolean);
  const menuCurrency = detectMenuCurrency(lines);
  const items: MenuTextItem[] = [];
  const categories: string[] = [];
  let category: string | null = null;
  let priced = 0;

  for (const line of lines) {
    const written = findPrices(line);
    if (written.length === 1) {
      const p = written[0];
      const name = cleanName(line.slice(0, p.index) + " " + line.slice(p.index + p.length));
      priced += 1;
      if (name) items.push({ name, amount: p.amount, currency: p.currency, category, currencySource: "written" });
      continue;
    }
    if (written.length > 1) {
      priced += 1; // size variants on one line — kept for the vision step, not guessed here
      continue;
    }
    const bare = BARE_PRICE_END.exec(line) ?? swap(BARE_PRICE_START.exec(line));
    if (bare) {
      const value = Number(bare[2].replace(",", "."));
      const name = cleanName(bare[1]);
      if (name && value > 0 && value < 10_000) {
        priced += 1;
        items.push({
          name,
          amount: menuCurrency ? formatAmount(value, menuCurrency) : trimAmount(value),
          currency: menuCurrency,
          category,
          currencySource: menuCurrency ? "menu" : null,
        });
        continue;
      }
    }
    // A short unpriced line between priced ones is a section heading.
    if (line.length <= 40 && /\p{L}{3,}/u.test(line) && !/\d{3,}/.test(line) && !MENU_CURRENCY_NOTE.test(line)) {
      category = line.replace(/[:\-–—|]+$/, "").trim();
      if (!categories.includes(category) && categories.length < 30) categories.push(category);
    }
  }
  return { items: dedupe(items), categories: categories.filter((c) => items.some((i) => i.category === c)), lines: lines.length, pricedLines: priced, menuCurrency };
}

function swap(m: RegExpExecArray | null): [string, string, string] | null {
  return m ? [m[0], m[2], m[1]] : null;
}

function trimAmount(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v);
}

export function detectMenuCurrency(lines: string[]): string | null {
  const counts = new Map<string, number>();
  for (const l of lines) for (const p of findPrices(l)) counts.set(p.currency, (counts.get(p.currency) ?? 0) + 1);
  for (const l of lines) {
    const m = MENU_CURRENCY_NOTE.exec(l);
    if (m) {
      const probe = findPrices(`1 ${m[4]}`)[0];
      if (probe) counts.set(probe.currency, (counts.get(probe.currency) ?? 0) + 5);
    }
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  // One currency, clearly stated — never a mix.
  return ranked.length === 1 || (ranked.length > 1 && ranked[0][1] >= 3 * ranked[1][1]) ? (ranked[0]?.[0] ?? null) : null;
}

function dedupe(items: MenuTextItem[]): MenuTextItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = `${i.name.toLowerCase()}|${i.amount}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export type OcrVerdict = { sufficient: boolean; reason: string };

/**
 * OCR is trusted on its own only when it is clearly good: confident, one
 * dominant script, several priced lines and most priced lines parsed into
 * items. Arabic, mixed-script, low-confidence or layout-heavy results go
 * on to the vision model (spec: "incomplete, ambiguous, multilingual, or
 * layout-heavy").
 */
export function ocrVerdict(ocr: OcrResult | null, parsed: ParsedMenuText | null): OcrVerdict {
  if (!ocr || !parsed) return { sufficient: false, reason: "OCR unavailable" };
  if (ocr.confidence < 75) return { sufficient: false, reason: `low OCR confidence (${Math.round(ocr.confidence)}%)` };
  if (ocr.arabicShare > 0.1 && ocr.latinShare > 0.1) return { sufficient: false, reason: "mixed Arabic/Latin text" };
  if (ocr.arabicShare > 0.1 && ocr.confidence < 90) return { sufficient: false, reason: "Arabic text (OCR less reliable)" };
  if (parsed.items.length < 3) return { sufficient: false, reason: `only ${parsed.items.length} item(s) read` };
  if (parsed.pricedLines > 0 && parsed.items.length / parsed.pricedLines < 0.8) return { sufficient: false, reason: "complex layout (prices not matched to names)" };
  const weak = ocr.lines.filter((l) => l.confidence < 60).length;
  if (weak / Math.max(ocr.lines.length, 1) > 0.25) return { sufficient: false, reason: "many unclear lines" };
  return { sufficient: true, reason: `OCR read ${parsed.items.length} items at ${Math.round(ocr.confidence)}%` };
}
