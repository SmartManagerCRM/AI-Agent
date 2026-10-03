import "server-only";

import { glossaryTranslate } from "./glossary";
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
  provider: Exclude<TranslationProvider, "glossary" | "copy">;
  /** Monthly characters this app lets it use (null: no cap). */
  limit: number | null;
  translate: (texts: string[], from: ContentLang, to: ContentLang) => Promise<ServiceOutcome>;
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
    services.push({ provider: "azure_free", limit: AZURE_FREE_MONTHLY_CHARACTERS, translate: (t, f, to) => azureTranslate({ key: azureKey, region }, t, f, to) });
  }
  const deeplKey = env.DEEPL_API_KEY?.trim();
  if (deeplKey) {
    services.push({ provider: "deepl_free", limit: DEEPL_FREE_MONTHLY_CHARACTERS, translate: (t, f, to) => deeplTranslate(deeplKey, t, f, to) });
  }
  const paidKey = env.AZURE_TRANSLATOR_PAID_KEY?.trim();
  if (paidKey) {
    const region = env.AZURE_TRANSLATOR_PAID_REGION?.trim() || undefined;
    services.push({
      provider: "azure_paid",
      limit: positiveInt(env.AZURE_TRANSLATOR_PAID_MONTHLY_LIMIT),
      translate: (t, f, to) => azureTranslate({ key: paidKey, region }, t, f, to),
    });
  }
  services.push({ provider: "local", limit: null, translate: localTranslate });
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
  const remaining = new Map<string, number[]>();
  jobs.forEach((job, i) => {
    const text = job.text.trim();
    if (!text) return;
    if (!hasLetters(text)) {
      results[i] = { text, provider: "copy" };
      return;
    }
    const fromList = glossaryTranslate(text, job.from, job.to);
    if (fromList) {
      results[i] = { text: fromList, provider: "glossary" };
      return;
    }
    const pair = `${job.from}>${job.to}`;
    remaining.set(pair, [...(remaining.get(pair) ?? []), i]);
  });

  const texts = jobs.map((j) => j.text.trim());
  const skipped = new Set<string>(); // services out of allowance / unavailable for the rest of this run
  for (const [pair, indexes] of remaining) {
    const [from, to] = pair.split(">") as [ContentLang, ContentLang];
    for (const batch of batches(indexes, texts)) {
      const batchTexts = batch.map((i) => texts[i]);
      const characters = batchTexts.reduce((n, t) => n + t.length, 0);
      for (const service of services) {
        if (skipped.has(service.provider)) continue;
        const { data: allowed, error } = await supabase.rpc("reserve_translation_characters", {
          p_provider: service.provider,
          p_characters: characters,
          p_limit: service.limit,
        });
        // Not enough of this month's allowance left for this batch: the next service takes it.
        if (error || !allowed) continue;
        const outcome = await service.translate(batchTexts, from, to);
        if (outcome.ok) {
          batch.forEach((i, k) => (results[i] = { text: outcome.texts[k].trim(), provider: service.provider }));
          break;
        }
        await supabase.rpc("settle_translation_characters", { p_provider: service.provider, p_refund: characters, p_exhausted: outcome.reason === "quota" });
        if (outcome.reason !== "failed") skipped.add(service.provider);
      }
    }
  }
  return results;
}
