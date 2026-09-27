import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type PlatformAgentStats = { total: number; deterministicPct: number; totalCostUsd: number };

/**
 * Platform-wide AI cost/deterministic-ratio (spec §69), across every
 * tenant — the same `is_super_admin()` bypass on `agent_interactions_select`
 * that already lets Super Admin read every tenant's rows is what makes
 * this possible with no new SQL function. Kept out of the page component
 * itself (`platform/page.tsx`) purely so `Date.now()` isn't called inside
 * a component body (React's purity rule flags that even though nothing
 * here is actually re-rendered on it).
 */
export async function getPlatformAgentStats(supabase: TypedSupabaseClient, windowDays: number): Promise<PlatformAgentStats> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: interactions } = await supabase.from("agent_interactions").select("handled_by, estimated_cost_usd").gte("created_at", since);

  const total = interactions?.length ?? 0;
  const deterministicCount = interactions?.filter((i) => i.handled_by === "deterministic").length ?? 0;
  const totalCostUsd = (interactions ?? []).reduce((sum, i) => sum + i.estimated_cost_usd, 0);
  const deterministicPct = total > 0 ? Math.round((deterministicCount / total) * 1000) / 10 : 0;

  return { total, deterministicPct, totalCostUsd };
}
