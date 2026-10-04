/** The languages content is kept in (the console and Agent languages). */
export const CONTENT_LANGS = ["en", "ar", "fr"] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

export const isContentLang = (value: unknown): value is ContentLang => typeof value === "string" && (CONTENT_LANGS as readonly string[]).includes(value);

/**
 * Where a translation came from. "glossary", "copy" and "split" (the other
 * half of a name already written in two languages) cost nothing and call no service.
 */
export type TranslationProvider = "glossary" | "copy" | "split" | "azure_free" | "deepl_free" | "azure_paid" | "local";

/** A word kept as written (a brand or dish name), with its spelling per language when it has one. */
export type KeepTerm = { forms: Partial<Record<ContentLang, string>> };

export type TranslationJob = { text: string; from: ContentLang; to: ContentLang; keep?: KeepTerm[] };
export type TranslationResult = { text: string; provider: TranslationProvider } | null;

/** What a translation service answered for one batch. */
export type ServiceOutcome =
  | { ok: true; texts: string[] }
  /** The service's allowance is used up (for this month): skip it until the next one. */
  | { ok: false; reason: "quota" }
  /** Not configured, refused (bad key), unreachable or failed: try the next service. */
  | { ok: false; reason: "unavailable" | "failed" };
