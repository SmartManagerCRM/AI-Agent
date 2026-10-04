import { CONTENT_LANGS, type ContentLang, type KeepTerm } from "./types";

/**
 * Words kept as written when translating — the business's own name and the
 * words the owner lists (Settings → Translation), e.g. a restaurant called
 * "Khayal" (خيال) whose "شوربة خيال" must become "Khayal Soup", not
 * "Fantasy soup". A term can carry one spelling per script.
 */

const ARABIC = /[؀-ۿ]/;

/**
 * One line per term: "Khayal", or the same name in each script separated by
 * "=" — "خيال = Khayal" (the first Latin spelling is English, a second one French).
 */
export function parseKeepWords(lines: string[]): KeepTerm[] {
  const terms: KeepTerm[] = [];
  for (const line of lines) {
    const parts = line.split("=").map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    const forms: KeepTerm["forms"] = {};
    const latin = parts.filter((p) => !ARABIC.test(p));
    const arabic = parts.find((p) => ARABIC.test(p));
    if (arabic) forms.ar = arabic;
    if (latin[0]) forms.en = latin[0];
    if (latin[1] ?? latin[0]) forms.fr = latin[1] ?? latin[0];
    terms.push({ forms });
  }
  return terms.slice(0, 100);
}

/** The business name, in whichever languages it is written, as one term. */
export function termFromName(name: Record<string, string> | null | undefined): KeepTerm | null {
  if (!name) return null;
  const forms: KeepTerm["forms"] = {};
  for (const lang of CONTENT_LANGS) if (typeof name[lang] === "string" && name[lang].trim()) forms[lang] = name[lang].trim();
  return Object.keys(forms).length ? { forms } : null;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordPattern = (form: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(form)}(?![\\p{L}\\p{N}])`, "giu");

/** How a term is written in `lang`: its own spelling, else one in the same script, else as found. */
function formIn(term: KeepTerm, lang: ContentLang, found: string): string {
  if (term.forms[lang]) return term.forms[lang]!;
  if (lang === "ar") return found;
  return term.forms.en ?? term.forms.fr ?? found;
}

/** The terms that occur in a text (any of their spellings). */
export function termsIn(text: string, terms: KeepTerm[] = []): KeepTerm[] {
  return terms.filter((term) => Object.values(term.forms).some((form) => form && wordPattern(form).test(text)));
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The text ready for a translation service: as HTML with each kept term
 * already in the target language's spelling and marked "don't translate", and
 * as plain text (for the local models, which can't take markup).
 */
export function protect(text: string, to: ContentLang, terms: KeepTerm[]): { html: string; plain: string } {
  // Longest spellings first, so "Khayal Restaurant" wins over "Khayal".
  const spellings = terms
    .flatMap((term) => Object.values(term.forms).filter(Boolean).map((form) => ({ term, form: form! })))
    .sort((a, b) => b.form.length - a.form.length);
  type Piece = { text: string; kept: boolean };
  let pieces: Piece[] = [{ text, kept: false }];
  for (const { term, form } of spellings) {
    pieces = pieces.flatMap((piece) => {
      if (piece.kept) return [piece];
      const out: Piece[] = [];
      let last = 0;
      for (const m of piece.text.matchAll(wordPattern(form))) {
        if (m.index > last) out.push({ text: piece.text.slice(last, m.index), kept: false });
        out.push({ text: formIn(term, to, m[0]), kept: true });
        last = m.index + m[0].length;
      }
      if (last < piece.text.length) out.push({ text: piece.text.slice(last), kept: false });
      return out.length ? out : [piece];
    });
  }
  return {
    html: pieces.map((p) => (p.kept ? `<span translate="no" class="notranslate">${escapeHtml(p.text)}</span>` : escapeHtml(p.text))).join(""),
    plain: pieces.map((p) => p.text).join(""),
  };
}

/** A service's HTML answer back to plain text. */
export function fromHtml(html: string): string {
  return html
    .replace(/<\/?span[^>]*>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A name already written in two languages — "مقبلات باردة / COLD APPETIZERS" —
 * as its Arabic and Latin halves; null for anything else.
 */
export function splitBilingual(text: string): { ar: string; latin: string } | null {
  for (const sep of [" / ", "/", " | ", "|", " - "]) {
    const at = text.indexOf(sep);
    if (at <= 0) continue;
    const a = text.slice(0, at).trim();
    const b = text.slice(at + sep.length).trim();
    if (!a || !b || b.includes(sep.trim())) continue;
    const aAr = ARABIC.test(a);
    const bAr = ARABIC.test(b);
    if (aAr && !bAr && /[A-Za-z]/.test(b)) return { ar: a, latin: b };
    if (bAr && !aAr && /[A-Za-z]/.test(a)) return { ar: b, latin: a };
  }
  return null;
}
