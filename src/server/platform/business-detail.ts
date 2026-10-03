import "server-only";

import { getCostGuardStatus, type CostGuardStatus } from "@/server/ai/cost-guard";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

export type BusinessDetail = {
  tenant: {
    id: string;
    slug: string;
    businessName: string;
    businessTypeLabel: string;
    status: string;
    country: string | null;
    city: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    websiteUrl: string | null;
    timezone: string;
    currency: string;
    deploymentMode: string;
    createdAt: string;
  };
  owner: { name: string; email: string | null } | null;
  subscription: {
    planLabel: string | null;
    status: string | null;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
  } | null;
  brain: { sourceCount: number; pendingReview: number; approvedEntries: number; openConflicts: number };
  agent: {
    active: boolean;
    deploymentMode: string;
    interactions30d: number;
    deterministicPct: number;
    costUsd30d: number;
  };
  costGuard: CostGuardStatus & { tenantOverrideUsd: number | null };
  recentOrders: {
    id: string;
    orderNumber: number;
    customerName: string | null;
    totalMinor: number;
    status: string;
    createdAt: string;
  }[];
  ordersCount: number;
  conversationsCount: number;
  paymentSummary: { totalPaidMinor: number; currency: string | null };
  recentActivity: { id: number; action: string; entity: string; at: string; actorName: string | null }[];
};

/** Everything a Super Admin needs to support/troubleshoot one business (spec §21 "Business 360") — read-only, every number real. */
/** Names come in `locale` where the business / plan / type has one, else English. */
export async function getBusinessDetail(supabase: TypedSupabaseClient, slug: string, locale = "en"): Promise<BusinessDetail | null> {
  const { data: tenant } = await supabase
    .from("tenants")
    .select(
      "id, slug, business_name, business_type_key, status, country, city, contact_email, contact_phone, website_url, timezone, currency, deployment_mode, created_at",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) return null;

  const [
    { data: businessType },
    { data: ownerRole },
    { data: subscription },
    { data: sources },
    { data: entries },
    { data: conflicts },
    { data: tenantSettings },
    { data: agentStats },
    { data: recentOrders },
    { count: ordersCount },
    { count: conversationsCount },
    { data: succeededPayments },
    { data: activity },
    costGuard,
  ] = await Promise.all([
    supabase.from("business_types").select("name").eq("key", tenant.business_type_key).maybeSingle(),
    supabase.from("roles").select("id").is("tenant_id", null).eq("key", "business_owner").maybeSingle(),
    supabase
      .from("subscriptions")
      .select("plan_key, status, current_period_end, trial_ends_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.from("business_sources").select("id").eq("tenant_id", tenant.id),
    supabase
      .from("business_brain_entries")
      .select("id, status")
      .eq("tenant_id", tenant.id)
      .in("status", ["pending_review", "approved"]),
    supabase.from("business_brain_conflicts").select("id").eq("tenant_id", tenant.id).eq("status", "open"),
    supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.rpc("agent_interaction_stats", { p_tenant_id: tenant.id }),
    supabase
      .from("orders")
      .select("id, order_number, customer_name, total_minor, status, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase.from("payments").select("amount_minor, currency").eq("tenant_id", tenant.id).eq("status", "succeeded"),
    supabase
      .from("audit_logs")
      .select("id, action, entity, actor_id, at")
      .eq("tenant_id", tenant.id)
      .order("at", { ascending: false })
      .limit(8),
    getCostGuardStatus(tenant.id),
  ]);
  // The AI budget column is hidden from signed-in users (column grants);
  // only Super Admin pages call this, after `requireSuperAdmin`.
  const { data: budgetRow } = await serviceClient()
    .from("tenant_settings")
    .select("ai_monthly_budget_usd")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  let planLabel: string | null = null;
  if (subscription?.plan_key) {
    const { data: planRow } = await supabase
      .from("subscription_plans")
      .select("name")
      .eq("key", subscription.plan_key)
      .maybeSingle();
    planLabel = planRow?.name[locale] ?? planRow?.name.en ?? subscription.plan_key;
  }

  let owner: { name: string; email: string | null } | null = null;
  if (ownerRole) {
    const { data: ownerMember } = await supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("role_id", ownerRole.id)
      .maybeSingle();
    if (ownerMember) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, email")
        .eq("id", ownerMember.user_id)
        .maybeSingle();
      owner = { name: profile?.full_name ?? profile?.email ?? "—", email: profile?.email ?? null };
    }
  }

  const actorIds = [...new Set((activity ?? []).map((a) => a.actor_id).filter((id): id is string => id !== null))];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const actorById = new Map((actors ?? []).map((a) => [a.id, a.full_name ?? a.email ?? "—"]));

  const agentSettings = (tenantSettings?.agent as { active?: boolean } | null) ?? null;
  const stats = agentStats?.[0];
  const totalPaidMinor = (succeededPayments ?? []).reduce((sum, p) => sum + p.amount_minor, 0);
  const paymentCurrency = succeededPayments?.[0]?.currency ?? null;

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      businessName: tenant.business_name[locale] ?? tenant.business_name.en ?? tenant.slug,
      businessTypeLabel: businessType?.name[locale] ?? businessType?.name.en ?? tenant.business_type_key,
      status: tenant.status,
      country: tenant.country,
      city: tenant.city,
      contactEmail: tenant.contact_email,
      contactPhone: tenant.contact_phone,
      websiteUrl: tenant.website_url,
      timezone: tenant.timezone,
      currency: tenant.currency,
      deploymentMode: tenant.deployment_mode,
      createdAt: tenant.created_at,
    },
    owner,
    subscription: subscription
      ? {
          planLabel,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
          trialEndsAt: subscription.trial_ends_at,
        }
      : null,
    brain: {
      sourceCount: sources?.length ?? 0,
      pendingReview: (entries ?? []).filter((e) => e.status === "pending_review").length,
      approvedEntries: (entries ?? []).filter((e) => e.status === "approved").length,
      openConflicts: conflicts?.length ?? 0,
    },
    agent: {
      active: agentSettings?.active === true,
      deploymentMode: tenant.deployment_mode,
      interactions30d: stats?.total_interactions ?? 0,
      deterministicPct: stats?.deterministic_pct ?? 0,
      costUsd30d: stats?.total_cost_usd ?? 0,
    },
    costGuard: { ...costGuard, tenantOverrideUsd: budgetRow?.ai_monthly_budget_usd ?? null },
    recentOrders: (recentOrders ?? []).map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      customerName: o.customer_name,
      totalMinor: o.total_minor,
      status: o.status,
      createdAt: o.created_at,
    })),
    ordersCount: ordersCount ?? 0,
    conversationsCount: conversationsCount ?? 0,
    paymentSummary: { totalPaidMinor, currency: paymentCurrency },
    recentActivity: (activity ?? []).map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      at: a.at,
      actorName: a.actor_id ? (actorById.get(a.actor_id) ?? null) : null,
    })),
  };
}
