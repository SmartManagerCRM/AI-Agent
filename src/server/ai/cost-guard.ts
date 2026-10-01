import "server-only";

import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

export type CostGuardStatus = {
  /** Effective monthly budget in USD — tenant override, else the platform default, else null (no cap). */
  budgetUsd: number | null;
  /** Real spend so far this calendar month (UTC), summed from `agent_interactions.estimated_cost_usd`. */
  spentUsd: number;
  exceeded: boolean;
};

function startOfMonthUtc(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/**
 * AI Cost Guard (spec §98). The platform pays for AI usage directly
 * (Gemini/Anthropic keys are platform env vars) while a tenant's
 * subscription is a flat plan price, never metered per token — so a
 * runaway or abused agent is a real cost to the platform, not the
 * tenant. `budgetUsd` is null (no cap) until a Super Admin sets a real
 * platform default or a real per-tenant override; this never fabricates
 * a default limit.
 *
 * Always reads through the service client, the same defensive choice
 * `runAgentGateway`'s own entitlement check already makes — this must
 * give the same answer regardless of which client the caller happens to
 * be using (a staff session missing some permission should never make a
 * genuinely over-budget tenant look fine, or vice versa).
 */
export async function getCostGuardStatus(tenantId: string): Promise<CostGuardStatus> {
  const supabase = serviceClient();
  const [{ data: tenantSettings }, { data: platformSettings }, { data: interactions }] = await Promise.all([
    supabase.from("tenant_settings").select("ai_monthly_budget_usd").eq("tenant_id", tenantId).maybeSingle(),
    supabase.from("platform_settings").select("default_ai_monthly_budget_usd").eq("id", true).maybeSingle(),
    supabase
      .from("agent_interactions")
      .select("estimated_cost_usd")
      .eq("tenant_id", tenantId)
      .gte("created_at", startOfMonthUtc()),
  ]);

  const budgetUsd = tenantSettings?.ai_monthly_budget_usd ?? platformSettings?.default_ai_monthly_budget_usd ?? null;
  const spentUsd = (interactions ?? []).reduce((sum, row) => sum + row.estimated_cost_usd, 0);

  return { budgetUsd, spentUsd, exceeded: budgetUsd !== null && spentUsd >= budgetUsd };
}

export type CostGuardAlert = {
  tenantId: string;
  slug: string;
  businessName: string;
  budgetUsd: number;
  spentUsd: number;
  severity: "warning" | "critical";
};

/**
 * Every tenant currently at or approaching (80%+) an actual, operator-set
 * monthly AI budget — for the Super Admin dashboard's alert feed. A
 * tenant with no effective budget (unlimited) never appears here; there
 * is nothing real to alert on.
 */
export async function getCostGuardAlerts(supabase: TypedSupabaseClient): Promise<CostGuardAlert[]> {
  // The AI budget columns are hidden from signed-in users (column grants) —
  // read with the service role; only the Super Admin dashboard calls this.
  const admin = serviceClient();
  const [{ data: tenants }, { data: tenantSettings }, { data: platformSettings }, { data: interactions }] =
    await Promise.all([
      supabase.from("tenants").select("id, slug, business_name"),
      admin.from("tenant_settings").select("tenant_id, ai_monthly_budget_usd"),
      admin.from("platform_settings").select("default_ai_monthly_budget_usd").eq("id", true).maybeSingle(),
      // Summed per tenant in Postgres — not every AI interaction this month.
      supabase.rpc("agent_interaction_totals_by_tenant", { p_since: startOfMonthUtc() }),
    ]);

  const overrideByTenant = new Map((tenantSettings ?? []).map((s) => [s.tenant_id, s.ai_monthly_budget_usd]));
  const defaultBudget = platformSettings?.default_ai_monthly_budget_usd ?? null;
  const spentByTenant = new Map<string, number>();
  for (const row of interactions ?? []) {
    spentByTenant.set(row.tenant_id, (spentByTenant.get(row.tenant_id) ?? 0) + Number(row.cost_usd));
  }

  const alerts: CostGuardAlert[] = [];
  for (const tenant of tenants ?? []) {
    const budgetUsd = overrideByTenant.get(tenant.id) ?? defaultBudget;
    if (budgetUsd === null || budgetUsd === undefined) continue;
    const spentUsd = spentByTenant.get(tenant.id) ?? 0;
    if (spentUsd < budgetUsd * 0.8) continue;
    alerts.push({
      tenantId: tenant.id,
      slug: tenant.slug,
      businessName: tenant.business_name.en ?? tenant.slug,
      budgetUsd,
      spentUsd,
      severity: spentUsd >= budgetUsd ? "critical" : "warning",
    });
  }
  return alerts;
}
