import { allRows } from "@/server/supabase/fetch-all";
import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type AnomalyAlert = {
  tenantId: string;
  slug: string;
  businessName: string;
  todayCount: number;
  baselineDailyAvg: number;
};

const MIN_TODAY_COUNT = 5;
const SPIKE_MULTIPLIER = 3;

/**
 * Anomaly detection (spec §98) — a simple, honest, rule-based check, not
 * a statistical model: flags a business whose conversation volume in the
 * last 24h is at least MIN_TODAY_COUNT and at least SPIKE_MULTIPLIER×
 * its own trailing 7-day daily average (days 2-8 ago, so "today" itself
 * never inflates its own baseline). A real, derivable signal of unusual
 * activity — never a fabricated "AI detected an anomaly" claim.
 */
export async function getAnomalyAlerts(supabase: TypedSupabaseClient): Promise<AnomalyAlert[]> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const todaySince = new Date(now - dayMs).toISOString();
  const baselineSince = new Date(now - 8 * dayMs).toISOString();
  const baselineUntil = todaySince;

  // Per-tenant counts from Postgres rather than a row per conversation.
  const [{ data: tenants }, { data: todayRows }, { data: baselineRows }] = await Promise.all([
    allRows((from, to) => supabase.from("tenants").select("id, slug, business_name").order("id").range(from, to)),
    supabase.rpc("conversation_counts_by_tenant", { p_since: todaySince, p_until: null }),
    supabase.rpc("conversation_counts_by_tenant", { p_since: baselineSince, p_until: baselineUntil }),
  ]);

  const todayByTenant = new Map<string, number>();
  for (const row of todayRows ?? []) todayByTenant.set(row.tenant_id, Number(row.conversations));

  const baselineByTenant = new Map<string, number>();
  for (const row of baselineRows ?? []) baselineByTenant.set(row.tenant_id, Number(row.conversations));

  const alerts: AnomalyAlert[] = [];
  for (const tenant of tenants ?? []) {
    const todayCount = todayByTenant.get(tenant.id) ?? 0;
    if (todayCount < MIN_TODAY_COUNT) continue;
    const baselineDailyAvg = (baselineByTenant.get(tenant.id) ?? 0) / 7;
    if (todayCount < baselineDailyAvg * SPIKE_MULTIPLIER) continue;
    alerts.push({
      tenantId: tenant.id,
      slug: tenant.slug,
      businessName: tenant.business_name.en ?? tenant.slug,
      todayCount,
      baselineDailyAvg: Math.round(baselineDailyAvg * 10) / 10,
    });
  }
  return alerts;
}
