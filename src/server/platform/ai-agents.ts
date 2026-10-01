import "server-only";

import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

export type PlatformAgentRow = {
  tenantId: string;
  slug: string;
  businessName: string;
  active: boolean;
  deploymentMode: string;
  interactions30d: number;
  deterministicPct: number;
  costUsd30d: number;
  budgetUsd: number | null;
};

/**
 * Cross-tenant Agent status/usage list (spec §98 "AI Agents management").
 * One bulk read of `agent_interactions` (Super Admin's RLS bypass already
 * covers it) grouped in JS, rather than N+1 calls to the per-tenant
 * `agent_interaction_stats` RPC that Business 360 uses — same discipline
 * `getPlatformAgentStats` already established for the dashboard's own
 * platform-wide AI figure.
 */
export async function getPlatformAgentRows(supabase: TypedSupabaseClient): Promise<PlatformAgentRow[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // AI budget columns are hidden from signed-in users (column grants); this
  // page is Super Admin only (`requireSuperAdmin` before the call).
  const admin = serviceClient();
  const [{ data: tenants }, { data: tenantSettings }, { data: interactions }, { data: platformSettings }] =
    await Promise.all([
      supabase.from("tenants").select("id, slug, business_name, deployment_mode").order("business_name"),
      admin.from("tenant_settings").select("tenant_id, agent, ai_monthly_budget_usd"),
      supabase.from("agent_interactions").select("tenant_id, handled_by, estimated_cost_usd, request_type").gte("created_at", since),
      admin.from("platform_settings").select("default_ai_monthly_budget_usd").eq("id", true).maybeSingle(),
    ]);

  const settingsByTenant = new Map((tenantSettings ?? []).map((s) => [s.tenant_id, s]));
  const defaultBudget = platformSettings?.default_ai_monthly_budget_usd ?? null;

  const statsByTenant = new Map<string, { total: number; deterministic: number; cost: number }>();
  for (const row of interactions ?? []) {
    const stat = statsByTenant.get(row.tenant_id) ?? { total: 0, deterministic: 0, cost: 0 };
    stat.cost += row.estimated_cost_usd;
    // Business Discovery AI calls are spend, not customer interactions.
    if (row.request_type === "brain_ingestion") {
      statsByTenant.set(row.tenant_id, stat);
      continue;
    }
    stat.total += 1;
    if (row.handled_by === "deterministic") stat.deterministic += 1;
    statsByTenant.set(row.tenant_id, stat);
  }

  return (tenants ?? []).map((tenant): PlatformAgentRow => {
    const settings = settingsByTenant.get(tenant.id);
    const agent = (settings?.agent as { active?: boolean } | null) ?? null;
    const stat = statsByTenant.get(tenant.id) ?? { total: 0, deterministic: 0, cost: 0 };
    return {
      tenantId: tenant.id,
      slug: tenant.slug,
      businessName: tenant.business_name.en ?? tenant.slug,
      active: agent?.active === true,
      deploymentMode: tenant.deployment_mode,
      interactions30d: stat.total,
      deterministicPct: stat.total > 0 ? Math.round((stat.deterministic / stat.total) * 1000) / 10 : 0,
      costUsd30d: stat.cost,
      budgetUsd: settings?.ai_monthly_budget_usd ?? defaultBudget,
    };
  });
}
