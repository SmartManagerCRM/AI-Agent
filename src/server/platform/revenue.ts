import { allRows, fetchAll, fetchByIds } from "@/server/supabase/fetch-all";
import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type RevenueSummary = {
  currency: string | null;
  totalRevenueMinor: number;
  mrrMinor: number;
  succeededCount: number;
  failedCount: number;
  pendingCount: number;
};

/**
 * Super Admin Master Spec, Phase 3 — Payments & Revenue. This is the
 * platform's own SaaS income from its subscriber businesses
 * (`subscription_payments`/`subscription_plans`), never to be confused
 * with a tenant's own end-customer `payments` table (a subscriber's
 * customers paying that subscriber) — see business-detail.ts's
 * `paymentSummary` for that other, tenant-scoped figure.
 *
 * Revenue/MRR are summed within one currency only, same discipline as
 * dashboard-stats.ts's `getPlatformKpis` (mixing currencies without an FX
 * rate would be a fabricated number) — but the reporting currency here is
 * derived from the payments/plans themselves (the platform's actual
 * billing currency), not from tenants' storefront currency, since
 * platform billing is deliberately independent of that (see the
 * subscriptions migration's own comment).
 */
export async function getRevenueSummary(supabase: TypedSupabaseClient): Promise<RevenueSummary> {
  const [{ data: payments }, { data: activeSubs }, { data: plans }] = await Promise.all([
    allRows((from, to) => supabase.from("subscription_payments").select("amount_minor, currency, status").order("id").range(from, to)),
    allRows((from, to) => supabase.from("subscriptions").select("plan_key").in("status", ["active", "trialing"]).order("tenant_id").range(from, to)),
    supabase.from("subscription_plans").select("key, price_minor, currency, billing_interval"),
  ]);

  const currencyCounts = new Map<string, number>();
  for (const p of payments ?? []) currencyCounts.set(p.currency, (currencyCounts.get(p.currency) ?? 0) + 1);
  const reportingCurrency =
    [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
    (plans ?? []).find((p) => p.currency)?.currency ??
    null;

  const succeeded = (payments ?? []).filter((p) => p.status === "succeeded");
  const totalRevenueMinor = succeeded
    .filter((p) => p.currency === reportingCurrency)
    .reduce((sum, p) => sum + p.amount_minor, 0);

  const planByKey = new Map((plans ?? []).map((p) => [p.key, p]));
  const mrrMinor = (activeSubs ?? []).reduce((sum, s) => {
    const plan = planByKey.get(s.plan_key);
    if (!plan || plan.currency !== reportingCurrency) return sum;
    return sum + (plan.billing_interval === "year" ? Math.round(plan.price_minor / 12) : plan.price_minor);
  }, 0);

  return {
    currency: reportingCurrency,
    totalRevenueMinor,
    mrrMinor,
    succeededCount: succeeded.length,
    failedCount: (payments ?? []).filter((p) => p.status === "failed").length,
    pendingCount: (payments ?? []).filter((p) => p.status === "pending").length,
  };
}

export type PlatformPaymentRow = {
  id: string;
  tenantId: string | null;
  businessName: string;
  slug: string | null;
  planLabel: string;
  status: string;
  amountMinor: number;
  currency: string;
  failureReason: string | null;
  createdAt: string;
};

export async function getRecentPayments(
  supabase: TypedSupabaseClient,
  status?: "succeeded" | "failed" | "pending",
  limit = 100,
): Promise<PlatformPaymentRow[]> {
  // `limit` = Infinity: every payment (the CSV export).
  const query = () => {
    const q = supabase
      .from("subscription_payments")
      .select("id, tenant_id, plan_key, status, amount_minor, currency, failure_reason, created_at")
      .order("created_at", { ascending: false })
      .order("id");
    return status ? q.eq("status", status) : q;
  };
  const rows = Number.isFinite(limit) ? ((await query().limit(limit)).data ?? []) : await fetchAll((from, to) => query().range(from, to));

  const tenantIds = [...new Set(rows.map((p) => p.tenant_id))];
  const [{ data: tenants }, { data: plans }] = await Promise.all([
    fetchByIds(tenantIds, (ids, from, to) => supabase.from("tenants").select("id, slug, business_name").in("id", ids).order("id").range(from, to)).then((data) => ({ data })),
    supabase.from("subscription_plans").select("key, name"),
  ]);
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const planNameByKey = new Map((plans ?? []).map((p) => [p.key, p.name.en ?? p.key]));

  return rows.map((p) => {
    const tenant = tenantById.get(p.tenant_id);
    return {
      id: p.id,
      tenantId: p.tenant_id,
      businessName: tenant?.business_name.en ?? tenant?.slug ?? "—",
      slug: tenant?.slug ?? null,
      planLabel: planNameByKey.get(p.plan_key) ?? p.plan_key,
      status: p.status,
      amountMinor: p.amount_minor,
      currency: p.currency,
      failureReason: p.failure_reason,
      createdAt: p.created_at,
    };
  });
}
