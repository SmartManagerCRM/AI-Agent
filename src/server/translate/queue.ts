import "server-only";

import { createHash } from "node:crypto";

import { after } from "next/server";

import { configuredServices, translateTexts } from "./engine";
import { CONTENT_LANGS, type ContentLang, type TranslationJob } from "./types";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Fills in the missing languages of what owners and the Super Admin write.
 * The database queues a row whenever one of its texts is added or changed
 * (translation_queue, filled by triggers); this works through the queue in
 * the background — after a save, and every few minutes (src/instrumentation.ts).
 *
 * Per text (e.g. a product's name):
 *   - a language someone typed is never changed;
 *   - an empty language is translated from one that was typed (English
 *     first, then Arabic, then French);
 *   - a language this filled in before is translated again when the text it
 *     came from changed.
 * Rows whose translation couldn't be done (no service available right now)
 * are retried later, waiting longer each time.
 */

type TableConfig = { key: "id" | "key"; fields: string[]; announcement?: boolean };

export const TRANSLATABLE: Record<string, TableConfig> = {
  products: { key: "id", fields: ["name", "description"] },
  categories: { key: "id", fields: ["name"] },
  bookable_services: { key: "id", fields: ["name", "description"] },
  membership_plans: { key: "id", fields: ["name", "description"] },
  subscription_plans: { key: "key", fields: ["name"] },
  business_types: { key: "key", fields: ["name"] },
  platform_announcements: { key: "id", fields: ["message_translations"], announcement: true },
};

type Meta = { field: string; lang: string; value: string; source_hash: string; source_lang: string };
type Row = Record<string, unknown>;

export const sourceHash = (lang: ContentLang, text: string) => createHash("sha256").update(`${lang}\u0000${text}`).digest("hex").slice(0, 32);

const ARABIC = /[؀-ۿ]/;
/** A text can be translated from this language only if it is written in its script. */
const fitsLanguage = (lang: ContentLang, text: string) => (lang === "ar" ? ARABIC.test(text) : !ARABIC.test(text));

/** A text's languages: the jsonb column, or for announcements the message in its own language plus its translations. */
function languagesOf(config: TableConfig, row: Row, field: string): Partial<Record<ContentLang, string>> {
  const raw = (config.announcement ? row.message_translations : row[field]) as unknown;
  const values: Partial<Record<ContentLang, string>> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const lang of CONTENT_LANGS) {
      const v = (raw as Record<string, unknown>)[lang];
      if (typeof v === "string" && v.trim()) values[lang] = v.trim();
    }
  }
  if (config.announcement && typeof row.message === "string" && typeof row.message_locale === "string") {
    values[row.message_locale as ContentLang] = row.message.trim();
  }
  return values;
}

export type PlannedTranslation = TranslationJob & { field: string; expected: string | null; sourceHash: string };

/** What a row needs translated (pure — tested in tests/unit/translate.test.ts). */
export function planRow(config: TableConfig, row: Row, metas: Meta[]): PlannedTranslation[] {
  const planned: PlannedTranslation[] = [];
  for (const field of config.fields) {
    const values = languagesOf(config, row, field);
    const auto = new Map(metas.filter((m) => m.field === field).map((m) => [m.lang, m]));
    const isAuto = (lang: ContentLang) => {
      const meta = auto.get(lang);
      return !!meta && meta.value.trim() === values[lang];
    };
    const typed = CONTENT_LANGS.filter(
      (lang) => values[lang] && (!isAuto(lang) || (config.announcement && lang === row.message_locale)) && fitsLanguage(lang, values[lang]!),
    );
    const source = typed[0];
    if (!source) continue;
    const text = values[source]!;
    const hash = sourceHash(source, text);
    for (const lang of CONTENT_LANGS) {
      if (lang === source || typed.includes(lang)) continue;
      const current = values[lang];
      if (current && !isAuto(lang)) continue; // typed (in another script) — left alone
      if (current) {
        const meta = auto.get(lang)!;
        if (meta.source_hash === hash) continue; // up to date
      }
      planned.push({ text, from: source, to: lang, field, expected: current ?? null, sourceHash: hash });
    }
  }
  return planned;
}

const RETRY_BASE_SECONDS = 15 * 60;
const RETRY_MAX_SECONDS = 24 * 60 * 60;

export type QueueRunResult = { claimed: number; translated: number; retried: number };

export async function processTranslationQueue(
  supabase: TypedSupabaseClient = serviceClient(),
  options: { limit?: number; services?: ReturnType<typeof configuredServices> } = {},
): Promise<QueueRunResult> {
  const { data: jobs } = await supabase.rpc("claim_translation_jobs", { p_limit: options.limit ?? 25 });
  if (!jobs?.length) return { claimed: 0, translated: 0, retried: 0 };

  type Work = { job: (typeof jobs)[number]; planned: PlannedTranslation[] };
  const work: Work[] = [];
  const db = supabase as unknown as {
    from: (table: string) => {
      select: (cols: string) => { in: (col: string, values: string[]) => Promise<{ data: Row[] | null }> };
    };
  };
  for (const [table, config] of Object.entries(TRANSLATABLE)) {
    const mine = jobs.filter((j) => j.table_name === table);
    if (!mine.length) continue;
    const keys = mine.map((j) => j.row_key);
    const cols = config.announcement ? "id, message, message_locale, message_translations" : [config.key, ...config.fields].join(", ");
    const [{ data: rows }, { data: metas }] = await Promise.all([
      db.from(table).select(cols).in(config.key, keys),
      supabase.from("content_translations").select("row_key, field, lang, value, source_hash, source_lang").eq("table_name", table).in("row_key", keys),
    ]);
    for (const job of mine) {
      const row = (rows ?? []).find((r) => String(r[config.key]) === job.row_key);
      work.push({ job, planned: row ? planRow(config, row, (metas ?? []).filter((m) => m.row_key === job.row_key)) : [] });
    }
  }
  for (const job of jobs.filter((j) => !TRANSLATABLE[j.table_name])) work.push({ job, planned: [] });

  const all = work.flatMap((w) => w.planned);
  const results = all.length ? await translateTexts(supabase, all, options.services) : [];
  let translated = 0;
  let retried = 0;
  let offset = 0;
  for (const { job, planned } of work) {
    let missing = false;
    for (const p of planned) {
      const result = results[offset++];
      if (!result) {
        missing = true;
        continue;
      }
      const { data: wrote } = await supabase.rpc("apply_content_translation", {
        p_table: job.table_name,
        p_key: job.row_key,
        p_field: p.field,
        p_lang: p.to,
        p_value: result.text,
        p_expected: p.expected,
        p_source_lang: p.from,
        p_source_hash: p.sourceHash,
        p_provider: result.provider,
      });
      if (wrote) translated++;
    }
    const retry = missing ? Math.min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * 2 ** Math.max(0, job.attempts - 1)) : null;
    if (missing) retried++;
    await supabase.rpc("finish_translation_job", { p_table: job.table_name, p_key: job.row_key, p_queued_at: job.queued_at, p_retry_in_seconds: retry });
  }
  return { claimed: jobs.length, translated, retried };
}

// One run at a time per server (runs on other servers are kept apart by the database's claims).
let running: Promise<void> | null = null;
let again = false;

/** Works through everything that is due, then stops. */
export function runTranslationQueue(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      for (let round = 0; round < 40; round++) {
        const result = await processTranslationQueue();
        if (result.claimed === 0) break;
      }
    } catch {
      // The rows stay queued; the next run picks them up.
    } finally {
      running = null;
      if (again) {
        again = false;
        void runTranslationQueue();
      }
    }
  })();
  return running;
}

/** After a save: translate in the background once the response is sent. */
export function translateSoon(): void {
  try {
    after(() => runTranslationQueue());
  } catch {
    void runTranslationQueue();
  }
}
