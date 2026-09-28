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

export type PlatformOverviewStats = {
  totalBusinesses: number;
  businessesByStatus: Record<string, number>;
  totalUsers: number;
  totalAdmins: number;
  /** Cumulative total businesses by day, last 30 days (running total as of each day, not that day's new signups). */
  signupSeries: { date: string; count: number }[];
};

/**
 * Cross-tenant platform metrics for the Super Admin overview — `tenants`,
 * `profiles` and `platform_admins` are all readable platform-wide by a
 * Super Admin already (same RLS bypass `getPlatformAgentStats` relies on),
 * so this is plain reads, no new SQL function needed.
 */
export async function getPlatformOverviewStats(supabase: TypedSupabaseClient): Promise<PlatformOverviewStats> {
  const [{ data: tenants }, { count: totalUsers }, { count: totalAdmins }] = await Promise.all([
    supabase.from("tenants").select("status, created_at"),
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("platform_admins").select("user_id", { count: "exact", head: true }),
  ]);

  const businessesByStatus: Record<string, number> = {};
  for (const tenant of tenants ?? []) {
    businessesByStatus[tenant.status] = (businessesByStatus[tenant.status] ?? 0) + 1;
  }

  const days: string[] = [];
  for (let i = 29; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const createdDates = (tenants ?? []).map((t) => t.created_at.slice(0, 10)).sort();
  const signupSeries = days.map((day) => ({
    date: day,
    count: createdDates.filter((created) => created <= day).length,
  }));

  return {
    totalBusinesses: tenants?.length ?? 0,
    businessesByStatus,
    totalUsers: totalUsers ?? 0,
    totalAdmins: totalAdmins ?? 0,
    signupSeries,
  };
}
