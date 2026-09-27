import { anthropicConfigured, anthropicProvider } from "./anthropic";
import { geminiConfigured, geminiProvider } from "./gemini";
import type { AIProvider, AIProviderKey } from "./provider";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Model router (spec §6): picks a model by request *kind* — `fast` for
 * routine/simple interactions, `agent` for complex reasoning — rather than
 * any call site hard-coding a model name. Reads `ai_model_configs`, so a
 * platform operator changes models/pricing/providers as data (Phase 9 adds
 * the Super Admin UI for it), never as a code change.
 *
 * No `import "server-only"` here, for the same reason as `gemini.ts`/
 * `anthropic.ts` (both of which this file imports): unit-testable under
 * Vitest. `TypedSupabaseClient` is a type-only import (erased at compile
 * time), so it carries no runtime dependency on the guarded client module.
 */
export type ModelKind = "fast" | "agent";

export type ModelConfigRow = {
  provider: AIProviderKey;
  model: string;
  kind: ModelKind;
  input_price_per_million_usd: number;
  output_price_per_million_usd: number;
  is_active: boolean;
  is_default: boolean;
};

export type SelectedModel = { row: ModelConfigRow; provider: AIProvider };

const PROVIDERS: Record<AIProviderKey, { provider: AIProvider; configured: () => boolean }> = {
  gemini: { provider: geminiProvider, configured: geminiConfigured },
  anthropic: { provider: anthropicProvider, configured: anthropicConfigured },
};

/**
 * Orders active rows for a kind: the `is_default` row first, then the rest —
 * this is the router's fallback order (spec §68) if the first choice's
 * provider has no credentials configured or its call fails.
 */
export function orderModelConfigs(rows: ModelConfigRow[], kind: ModelKind): ModelConfigRow[] {
  return rows
    .filter((row) => row.kind === kind && row.is_active)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** The first candidate whose provider actually has credentials configured. */
export function pickConfiguredModel(rows: ModelConfigRow[], kind: ModelKind): SelectedModel | null {
  for (const row of orderModelConfigs(rows, kind)) {
    const entry = PROVIDERS[row.provider];
    if (entry.configured()) return { row, provider: entry.provider };
  }
  return null;
}

/** All active, provider-configured candidates for a kind, in fallback order. */
export function fallbackChain(rows: ModelConfigRow[], kind: ModelKind): SelectedModel[] {
  return orderModelConfigs(rows, kind)
    .filter((row) => PROVIDERS[row.provider].configured())
    .map((row) => ({ row, provider: PROVIDERS[row.provider].provider }));
}

export async function loadModelConfigs(supabase: TypedSupabaseClient): Promise<ModelConfigRow[]> {
  const { data, error } = await supabase.from("ai_model_configs").select("*").eq("is_active", true);
  if (error) throw new Error(`Failed to load AI model configuration: ${error.message}`);
  return data ?? [];
}
