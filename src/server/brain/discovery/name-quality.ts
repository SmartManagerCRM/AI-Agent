/**
 * Is this a product/service name a person could read — or OCR noise?
 *
 * Real menus give names like "Spanish Latte", "قهوة عربية", "Crème brûlée",
 * "7UP", "Mandi (1/2)". Failed OCR gives "0. a . - ا EE A ; of" or
 * "1 00 sen 7 حا A | We Ÿ “2 de": many one-letter fragments, stray
 * symbols and digits, scripts chopped together. Such a "name" must never
 * reach a customer, whatever its confidence. Pure.
 */
export function isReadableName(raw: string): boolean {
  const name = raw.normalize("NFKC").replace(/[‎‏‪-‮]/g, "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 90) return false;

  // Ordinary menu punctuation — "Mandi (1/2)", "Mac & Cheese", "Pizza 30cm", "Chef's Special".
  const chars = [...name.replace(/[\s()&/+.,'’%-]/g, "")];
  const letters = chars.filter((c) => /\p{L}/u.test(c)).length;
  const digits = chars.filter((c) => /\p{N}/u.test(c)).length;
  const symbols = chars.length - letters - digits;
  if (letters < 2) return false;
  if (letters / Math.max(chars.length, 1) < 0.6) return false;
  if (symbols > 1) return false;
  if (/[|¦«»“”„‹›~^`_\\{}[\]<>=]/.test(name)) return false;

  // A name starts like a word, not with stray punctuation (", PO").
  if (!/^[\p{L}\p{N}]/u.test(name)) return false;

  const tokens = name.split(" ");
  // Fragments: one-character tokens that aren't a known short word.
  const fragments = tokens.filter((t) => [...t.replace(/[^\p{L}\p{N}]/gu, "")].length <= 1 && !/^[&+\-/()]$/.test(t)).length;
  if (fragments >= 2 && fragments / tokens.length > 0.25) return false;

  // Mostly one- or two-letter tokens ("0 cé PP. wet") is noise, not a dish name.
  const short = tokens.filter((t) => [...t.replace(/[^\p{L}\p{N}]/gu, "")].length <= 2).length;
  if (tokens.length >= 3 && short / tokens.length >= 0.6) return false;

  // Arabic and Latin words mixed together *with* 1–2 letter fragments is OCR noise
  // ("1 كبر for تم أل ايد"); a real bilingual name ("Shakshuka شكشوكة") has none.
  const hasArabic = /[\u0600-\u06FF]/.test(name);
  const hasLatin = /[A-Za-zÀ-ÿ]/.test(name);
  if (hasArabic && hasLatin && short > 0) return false;

  // Within a word, scripts don't mix (Arabic letters glued to Latin ones = OCR noise).
  for (const t of tokens) {
    const arabic = /[؀-ۿ]/.test(t);
    const latin = /[A-Za-zÀ-ÿ]/.test(t);
    if (arabic && latin) return false;
  }
  // Latin words need a vowel somewhere ("Ke", "Vas" pass; "PP", "Nr", "ty" alone as a whole name don't).
  const latinWords = tokens.filter((t) => /^[A-Za-zÀ-ÿ'’-]+$/.test(t));
  if (latinWords.length > 0 && latinWords.length === tokens.length && !latinWords.some((w) => /[aeiouyàâäéèêëîïôöùûüÿ]/i.test(w) && w.length >= 3)) return false;
  return true;
}
