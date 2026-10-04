import "server-only";

import { glossaryTranslate } from "./glossary";
import { fromHtml, protect, termsIn } from "./keep";
import { localTranslate } from "./local-models";
import { azureTranslate, deeplTranslate } from "./services";
import type { ContentLang, ServiceOutcome, TranslationJob, TranslationProvider, TranslationResult } from "./types";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Translates texts with no AI, cheapest first:
 *
 *   1. the built-in word list (./glossary.ts) — free, instant;
 *   2. Azure Translator, free tier (AZURE_TRANSLATOR_KEY) — up to 2,000,000
 *      characters a month;
 *   3. DeepL API Free (DEEPL_API_KEY) — up to 500,000 characters a month;
 *   4. Azure Translator, paid tier (AZURE_TRANSLATOR_PAID_KEY) — only if set,
 *      capped by AZURE_TRANSLATOR_PAID_MONTHLY_LIMIT when that is set;
 *   5. open-source models on this server (./local-models.ts).
 *
 * Words to keep (the business's name, words the owner lists — ./keep.ts) are
 * put in the target language's spelling and marked "don't translate" for the
 * services; the local models get them already in place.
 *
 * Each service's characters are counted in the database per calendar month
 * (translation_usage) before a request is sent, so a free allowance is never
 * exceeded; a service that answers "allowance used up" is skipped until the
 * next month. A text no step could translate stays as it is (the caller
 * retries later).
 */

export const AZURE_FREE_MONTHLY_CHARACTERS = 2_000_000;
export const DEEPL_FREE_MONTHLY_CHARACTERS = 500_000;

/** Texts per request, and characters per request (the services' own limits are higher). */
const BATCH_TEXTS = 50;
const BATCH_CHARACTERS = 20_000;

type Service = {
  provider: Exclude<TranslationProvider, "glossary" | "copy" | "split">;
  /** Monthly characters this app lets it use (null: no cap). */
  limit: number | null;
  /** Whether it takes HTML with "don't translate" marks (the services do; the local models don't). */
  markup: boolean;
  translate: (texts: string[], from: ContentLang, to: ContentLang, html: boolean) => Promise<ServiceOutcome>;
};

function positiveInt(value: string | undefined): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The chain, from the environment — services without a key are left out. */
export function configuredServices(env: NodeJS.ProcessEnv = process.env): Service[] {
  const services: Service[] = [];
  const azureKey = env.AZURE_TRANSLATOR_KEY?.trim();
  if (azureKey) {
    const region = env.AZURE_TRANSLATOR_REGION?.trim() || undefined;
    services.push({
      provider: "azure_free",
      limit: AZURE_FREE_MONTHLY_CHARACTERS,
      markup: true,
      translate: (t, f, to, html) => azureTranslate({ key: azureKey, region }, t, f, to, { html }),
    });
  }
  const deeplKey = env.DEEPL_API_KEY?.trim();
  if (deeplKey) {
    services.push({
      provider: "deepl_free",
      limit: DEEPL_FREE_MONTHLY_CHARACTERS,
      markup: true,
      translate: (t, f, to, html) => deeplTranslate(deeplKey, t, f, to, { html }),
    });
  }
  const paidKey = env.AZURE_TRANSLATOR_PAID_KEY?.trim();
  if (paidKey) {
    const region = env.AZURE_TRANSLATOR_PAID_REGION?.trim() || undefined;
    services.push({
      provider: "azure_paid",
      limit: positiveInt(env.AZURE_TRANSLATOR_PAID_MONTHLY_LIMIT),
      markup: true,
      translate: (t, f, to, html) => azureTranslate({ key: paidKey, region }, t, f, to, { html }),
    });
  }
  services.push({ provider: "local", limit: null, markup: false, translate: (t, f, to) => localTranslate(t, f, to) });
  return services;
}

/** Text with no letters at all (prices, codes like "7"): the same in every language. */
const hasLetters = (text: string) => /\p{L}/u.test(text);

function batches(indexes: number[], texts: string[]): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let size = 0;
  for (const i of indexes) {
    if (current.length > 0 && (current.length >= BATCH_TEXTS || size + texts[i].length > BATCH_CHARACTERS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += texts[i].length;
  }
  if (current.length) out.push(current);
  return out;
}

export async function translateTexts(
  supabase: TypedSupabaseClient,
  jobs: TranslationJob[],
  services: Service[] = configuredServices(),
): Promise<TranslationResult[]> {
  const results: TranslationResult[] = jobs.map(() => null);
  // Per job: the HTML (kept words marked) and plain versions sent out; groups per language pair and kind.
  const prepared: { html: string; plain: string; marked: boolean }[] = jobs.map((job) => ({ html: job.text.trim(), plain: job.text.trim(), marked: false }));
  const remaining = new Map<string, number[]>();
  jobs.forEach((job, i) => {
    const text = job.text.trim();
    if (!text) return;
    if (!hasLetters(text)) {
      results[i] = { text, provider: "copy" };
      return;
    }
    const kept = termsIn(text, job.keep);
    if (kept.length) {
      const p = protect(text, job.to, kept);
      // The whole text is a kept word: its spelling in the other language, no service needed.
      if (!/[\p{L}]/u.test(fromHtml(p.html.replace(/<span translate="no"[^>]*>[^<]*<\/span>/g, "")))) {
        results[i] = { text: p.plain, provider: "glossary" };
        return;
      }
      prepared[i] = { ...p, marked: true };
    } else {
      const fromList = glossaryTranslate(text, job.from, job.to);
      if (fromList) {
        results[i] = { text: fromList, provider: "glossary" };
        return;
      }
    }
    const group = `${job.from}>${job.to}>${prepared[i].marked ? 1 : 0}`;
    remaining.set(group, [...(remaining.get(group) ?? []), i]);
  });

  const sizes = prepared.map((p) => p.html);
  const skipped = new Set<string>(); // services out of allowance / unavailable for the rest of this run
  for (const [group, indexes] of remaining) {
    const [from, to, markedFlag] = group.split(">") as [ContentLang, ContentLang, string];
    const marked = markedFlag === "1";
    for (const batch of batches(indexes, sizes)) {
      for (const service of services) {
        if (skipped.has(service.provider)) continue;
        const html = marked && service.markup;
        const batchTexts = batch.map((i) => (html ? prepared[i].html : prepared[i].plain));
        const characters = batchTexts.reduce((n, t) => n + t.length, 0);
        const { data: allowed, error } = await supabase.rpc("reserve_translation_characters", {
          p_provider: service.provider,
          p_characters: characters,
          p_limit: service.limit,
        });
        // Not enough of this month's allowance left for this batch: the next service takes it.
        if (error || !allowed) continue;
        const outcome = await service.translate(batchTexts, from, to, html);
        if (outcome.ok) {
          batch.forEach((i, k) => (results[i] = { text: html ? fromHtml(outcome.texts[k]) : outcome.texts[k].trim(), provider: service.provider }));
          break;
        }
        await supabase.rpc("settle_translation_characters", { p_provider: service.provider, p_refund: characters, p_exhausted: outcome.reason === "quota" });
        if (outcome.reason !== "failed") skipped.add(service.provider);
      }
    }
  }
  return results;
}
