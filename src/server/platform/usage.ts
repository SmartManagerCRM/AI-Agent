import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";
import { parseUsageRows, type SubscriberUsageRow } from "./usage-analytics";

/** Usage this billing period, every subscriber or one — `platform_usage_overview` refuses anyone but Super Admin. */
export async function loadPlatformUsage(
  supabase: TypedSupabaseClient,
  tenantId?: string,
): Promise<SubscriberUsageRow[]> {
  const { data, error } = await supabase.rpc("platform_usage_overview", tenantId ? { p_tenant_id: tenantId } : {});
  if (error) throw new Error(`Failed to load usage: ${error.code ?? "UNKNOWN"}`);
  return parseUsageRows(data);
}

/** Plan-level AI cost caps (Super Admin RLS). */
export async function loadPlanAiCostLimits(supabase: TypedSupabaseClient): Promise<Map<string, number>> {
  const { data } = await supabase.from("ai_cost_limits").select("plan_key, limit_usd").not("plan_key", "is", null);
  return new Map((data ?? []).flatMap((r) => (r.plan_key ? [[r.plan_key, Number(r.limit_usd)] as const] : [])));
}

export async function loadUsageSettings(supabase: TypedSupabaseClient): Promise<{
  conversationWarningPercents: number[];
  aiCostWarningPercent: number;
  trialConversationLimit: number | null;
  trialAiCostLimitUsd: number | null;
}> {
  const { data } = await supabase
    .from("usage_settings")
    .select("conversation_warning_percents, ai_cost_warning_percent, trial_conversation_limit, trial_ai_cost_limit_usd")
    .eq("id", true)
    .maybeSingle();
  return {
    conversationWarningPercents: data?.conversation_warning_percents ?? [70, 85, 95],
    aiCostWarningPercent: data?.ai_cost_warning_percent ?? 80,
    trialConversationLimit: data ? data.trial_conversation_limit : 500,
    trialAiCostLimitUsd: data
      ? data.trial_ai_cost_limit_usd === null
        ? null
        : Number(data.trial_ai_cost_limit_usd)
      : 0.5,
  };
}
