import "server-only";

import { AZURE_FREE_MONTHLY_CHARACTERS, DEEPL_FREE_MONTHLY_CHARACTERS } from "./engine";
import { findModelRuntimeRoot } from "./local-models";
import type { TranslationProvider } from "./types";
import { serviceClient } from "@/server/supabase/clients";

export type ProviderStatus = {
  provider: Exclude<TranslationProvider, "copy">;
  configured: boolean;
  /** Characters this calendar month (UTC); null for the word list. */
  used: number | null;
  /** Monthly cap this app keeps to (null: none). */
  limit: number | null;
  exhausted: boolean;
};

/** Super Admin: the translation chain this month — service keys are never read out, only whether they are set. */
export async function translationStatus(): Promise<{ providers: ProviderStatus[]; waiting: number; translated: number }> {
  const admin = serviceClient();
  const period = new Date().toISOString().slice(0, 7) + "-01";
  const [{ data: usage }, { count: waiting }, { count: translated }] = await Promise.all([
    admin.from("translation_usage").select("provider, characters, exhausted_at").eq("period", period),
    admin.from("translation_queue").select("row_key", { count: "exact", head: true }),
    admin.from("content_translations").select("row_key", { count: "exact", head: true }),
  ]);
  const of = (p: string) => (usage ?? []).find((u) => u.provider === p);
  const paidLimit = Number(process.env.AZURE_TRANSLATOR_PAID_MONTHLY_LIMIT);
  const local = process.env.TRANSLATION_LOCAL_MODELS !== "off" && findModelRuntimeRoot() !== null;
  const row = (provider: ProviderStatus["provider"], configured: boolean, limit: number | null): ProviderStatus => ({
    provider,
    configured,
    used: Number(of(provider)?.characters ?? 0),
    limit,
    exhausted: !!of(provider)?.exhausted_at,
  });
  return {
    providers: [
      { provider: "glossary", configured: true, used: null, limit: null, exhausted: false },
      row("azure_free", !!process.env.AZURE_TRANSLATOR_KEY?.trim(), AZURE_FREE_MONTHLY_CHARACTERS),
      row("deepl_free", !!process.env.DEEPL_API_KEY?.trim(), DEEPL_FREE_MONTHLY_CHARACTERS),
      row("azure_paid", !!process.env.AZURE_TRANSLATOR_PAID_KEY?.trim(), Number.isInteger(paidLimit) && paidLimit > 0 ? paidLimit : null),
      row("local", local, null),
    ],
    waiting: waiting ?? 0,
    translated: translated ?? 0,
  };
}
