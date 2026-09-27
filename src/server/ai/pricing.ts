/**
 * Cost calculation from configurable model pricing (spec §29, §102).
 * Never hard-code a vendor's per-token price into business logic — this
 * function only ever multiplies token counts by whatever `ai_model_configs`
 * currently says, so a price change is a data edit, not a code change.
 */
export type ModelPricing = { inputPricePerMillionUsd: number; outputPricePerMillionUsd: number };

export function calculateCostUsd(pricing: ModelPricing, inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillionUsd;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillionUsd;
  // Six decimal places matches the `numeric(12,6)` column this feeds — sub-cent
  // amounts are the norm here (spec §25's $0.50 trial ceiling needs that
  // precision), so this is a deliberate rounding point, not float sloppiness.
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
