import "server-only";

import { getRevenueSummary } from "@/server/platform/revenue";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type DeepAnalytics = {
  churnRatePct: number;
  retentionRatePct: number;
  arpuMinor: number;
  arpuCurrency: string | null;
  subscriptionsByStatus: { status: string; count: number }[];
};

/**
 * Deep Analytics (spec §98) — real metrics not already on the dashboard:
 * churn/retention (from every subscription ever created, not just active
 * ones) and ARPU (real revenue this month ÷ real business count). Reuses
 * the same single-currency discipline as revenue.ts's own summary —
 * ARPU is computed in whichever currency that summary already settled on.
 */
export async function getDeepAnalytics(supabase: TypedSupabaseClient): Promise<DeepAnalytics> {
  const [{ data: subscriptions }, { count: businessCount }] = await Promise.all([
    supabase.from("subscriptions").select("status"),
    supabase.from("tenants").select("id", { count: "exact", head: true }),
  ]);

  const all = subscriptions ?? [];
  const total = all.length;
  const canceled = all.filter((s) => s.status === "canceled").length;
  const retained = all.filter((s) => s.status === "active" || s.status === "trialing").length;

  const byStatus = new Map<string, number>();
  for (const s of all) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);

  const revenue = await getRevenueSummary(supabase);

  return {
    churnRatePct: total > 0 ? Math.round((canceled / total) * 1000) / 10 : 0,
    retentionRatePct: total > 0 ? Math.round((retained / total) * 1000) / 10 : 0,
    arpuMinor: businessCount && businessCount > 0 ? Math.round(revenue.totalRevenueMinor / businessCount) : 0,
    arpuCurrency: revenue.currency,
    subscriptionsByStatus: Array.from(byStatus, ([status, count]) => ({ status, count })),
  };
}
