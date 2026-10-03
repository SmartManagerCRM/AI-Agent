import "server-only";

import { getCostGuardAlerts } from "@/server/ai/cost-guard";
import { getAnomalyAlerts } from "@/server/platform/anomaly-detection";
import type { Trend } from "@/server/tenant/dashboard-stats";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const COLORS = ["#10b981", "#3b82f6", "#8b5cf6", "#f59e0b", "#ef4444"];

function trend(current: number, prior: number): Trend {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 1000) / 10;
  return { pct: Math.abs(pct), direction: pct >= 0 ? "up" : "down" };
}

function windowSplit<T extends { createdAt: string }>(rows: T[], windowMs: number, now: number) {
  const current = rows.filter((r) => new Date(r.createdAt).getTime() >= now - windowMs);
  const prior = rows.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    return t >= now - 2 * windowMs && t < now - windowMs;
  });
  return { current, prior };
}

export type PlatformKpis = {
  totalSubscribers: number;
  totalSubscribersTrend: Trend;
  totalBusinesses: number;
  totalBusinessesTrend: Trend;
  activeAgents: number;
  activeAgentsPct: number;
  monthlyRevenueMinor: number;
  monthlyRevenueCurrency: string | null;
  monthlyRevenueTrend: Trend;
  totalConversations: number;
  totalConversationsTrend: Trend;
  activeSubscriptions: number;
  activeSubscriptionsTrend: Trend;
};

const WINDOW_DAYS = 30;

/**
 * The platform's six headline KPIs (spec §8) — every value and trend is a
 * real, tenant-scoped-bypassed read (Super Admin's RLS bypass already
 * covers every table here), never a hardcoded example. Trends compare the
 * last 30 days to the 30 days before that, same convention the Subscriber
 * Console's own Dashboard/Analytics already use.
 */
export async function getPlatformKpis(supabase: TypedSupabaseClient): Promise<PlatformKpis> {
  const now = Date.now();
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // Subscriber = the business_owner of a tenant (the account that actually
  // holds the subscription) — one per tenant, read directly rather than
  // through a role-name join since `tenant_members`/`roles` are small,
  // static-shaped tables and a Super Admin already reads every row.
  const { data: ownerRole } = await supabase
    .from("roles")
    .select("id")
    .is("tenant_id", null)
    .eq("key", "business_owner")
    .maybeSingle();

  const [
    { data: tenants },
    { data: tenantSettings },
    { data: payments },
    conversationCounts,
    { data: subscriptions },
    { data: owners },
  ] = await Promise.all([
    supabase.from("tenants").select("id, created_at, currency"),
    supabase.from("tenant_settings").select("tenant_id, agent"),
    supabase
      .from("subscription_payments")
      .select("amount_minor, currency, status, created_at")
      .eq("status", "succeeded"),
    // Counted in Postgres (head requests) rather than downloading every
    // conversation on the platform to count them in JS.
    Promise.all([
      supabase.from("conversations").select("id", { count: "exact", head: true }),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .gte("started_at", new Date(now - windowMs).toISOString()),
      supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .gte("started_at", new Date(now - 2 * windowMs).toISOString())
        .lt("started_at", new Date(now - windowMs).toISOString()),
    ]).then(([total, current, prior]) => ({
      total: total.count ?? 0,
      current: current.count ?? 0,
      prior: prior.count ?? 0,
    })),
    supabase.from("subscriptions").select("tenant_id, status, created_at"),
    ownerRole
      ? supabase.from("tenant_members").select("user_id, created_at").eq("role_id", ownerRole.id)
      : Promise.resolve({ data: [] as { user_id: string; created_at: string }[] }),
  ]);

  const allTenants = (tenants ?? []).map((t) => ({ id: t.id, createdAt: t.created_at, currency: t.currency }));
  const allOwners = (owners ?? []).map((o) => ({ createdAt: o.created_at }));
  const allSubscriptions = subscriptions ?? [];
  const activeSubs = allSubscriptions.filter((s) => s.status === "active");

  const { current: currentTenants, prior: priorTenants } = windowSplit(allTenants, windowMs, now);
  const { current: currentOwners, prior: priorOwners } = windowSplit(allOwners, windowMs, now);
  const { current: currentSubs, prior: priorSubs } = windowSplit(
    allSubscriptions.filter((s) => s.status === "active").map((s) => ({ createdAt: s.created_at })),
    windowMs,
    now,
  );

  const activeAgents = (tenantSettings ?? []).filter((s) => {
    const agent = s.agent as { active?: boolean } | null;
    return agent?.active === true;
  }).length;

  // Revenue is only ever summed within one currency (mixing currencies
  // without an FX rate would be a fabricated number) — the most common
  // currency among tenants is treated as the platform's reporting
  // currency; payments in any other currency are real but excluded from
  // this one headline figure rather than silently misrepresented.
  const currencyCounts = new Map<string, number>();
  for (const t of allTenants) currencyCounts.set(t.currency, (currencyCounts.get(t.currency) ?? 0) + 1);
  const reportingCurrency = [...currencyCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const paymentsInCurrency = (payments ?? []).filter((p) => p.currency === reportingCurrency);
  const { current: currentPayments, prior: priorPayments } = (() => {
    const current = paymentsInCurrency.filter((p) => new Date(p.created_at).getTime() >= now - windowMs);
    const priorRows = paymentsInCurrency.filter((p) => {
      const t = new Date(p.created_at).getTime();
      return t >= now - 2 * windowMs && t < now - windowMs;
    });
    return { current, prior: priorRows };
  })();

  const monthlyRevenueMinor = currentPayments.reduce((sum, p) => sum + p.amount_minor, 0);
  const priorRevenueMinor = priorPayments.reduce((sum, p) => sum + p.amount_minor, 0);

  return {
    totalSubscribers: allOwners.length,
    totalSubscribersTrend: trend(currentOwners.length, priorOwners.length),
    totalBusinesses: allTenants.length,
    totalBusinessesTrend: trend(currentTenants.length, priorTenants.length),
    activeAgents,
    activeAgentsPct: allTenants.length > 0 ? Math.round((activeAgents / allTenants.length) * 100) : 0,
    monthlyRevenueMinor,
    monthlyRevenueCurrency: reportingCurrency,
    monthlyRevenueTrend: trend(monthlyRevenueMinor, priorRevenueMinor),
    totalConversations: conversationCounts.total,
    totalConversationsTrend: trend(conversationCounts.current, conversationCounts.prior),
    activeSubscriptions: activeSubs.length,
    activeSubscriptionsTrend: trend(currentSubs.length, priorSubs.length),
  };
}

export type GrowthMetric = "subscribers" | "businesses" | "revenue" | "conversations";
export const GROWTH_RANGES = [30, 90, 365] as const;
export type GrowthRangeDays = (typeof GROWTH_RANGES)[number];

/** One metric's daily series over the selected range — computed on demand, not all four eagerly, matching the Subscriber Console Analytics page's own range-tab pattern. */
export async function getPlatformGrowthSeries(
  supabase: TypedSupabaseClient,
  metric: GrowthMetric,
  rangeDays: GrowthRangeDays,
): Promise<{ date: string; count: number }[]> {
  const now = Date.now();
  const since = new Date(now - rangeDays * 24 * 60 * 60 * 1000).toISOString();

  const days: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--)
    days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  const byDay = new Map(days.map((d) => [d, 0]));

  if (metric === "subscribers") {
    const { data: ownerRole } = await supabase
      .from("roles")
      .select("id")
      .is("tenant_id", null)
      .eq("key", "business_owner")
      .maybeSingle();
    const { data } = ownerRole
      ? await supabase.from("tenant_members").select("created_at").eq("role_id", ownerRole.id).gte("created_at", since)
      : { data: [] };
    for (const row of data ?? []) {
      const day = row.created_at.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  } else if (metric === "businesses") {
    const { data } = await supabase.from("tenants").select("created_at").gte("created_at", since);
    for (const row of data ?? []) {
      const day = row.created_at.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  } else if (metric === "conversations") {
    // Grouped per UTC day in Postgres instead of downloading every row.
    const { data } = await supabase.rpc("conversations_started_per_day", { p_since: since });
    for (const row of data ?? []) {
      if (byDay.has(row.day)) byDay.set(row.day, (byDay.get(row.day) ?? 0) + Number(row.conversations));
    }
  } else {
    const { data } = await supabase
      .from("subscription_payments")
      .select("amount_minor, created_at, status")
      .eq("status", "succeeded")
      .gte("created_at", since);
    for (const row of data ?? []) {
      const day = row.created_at.slice(0, 10);
      if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + row.amount_minor);
    }
  }

  // Subscribers/Businesses read as a running total (a growth curve), the
  // same convention the Subscriber Console's own signup-style charts use —
  // Conversations/Revenue read as that day's own activity instead.
  if (metric === "subscribers" || metric === "businesses") {
    let running = 0;
    return days.map((date) => {
      running += byDay.get(date) ?? 0;
      return { date, count: running };
    });
  }
  return days.map((date) => ({ date, count: byDay.get(date) ?? 0 }));
}

export type CompositionSegment = { label: string; count: number; color: string };

/** Names are given in `locale` (English when a plan or type has no name in it). */
export async function getSubscribersByPlan(supabase: TypedSupabaseClient, locale = "en"): Promise<CompositionSegment[]> {
  const [{ data: subscriptions }, { data: plans }] = await Promise.all([
    supabase.from("subscriptions").select("plan_key").eq("status", "active"),
    supabase.from("subscription_plans").select("key, name"),
  ]);
  const nameByKey = new Map((plans ?? []).map((p) => [p.key, p.name[locale] ?? p.name.en ?? p.key]));
  const counts = new Map<string, number>();
  for (const s of subscriptions ?? []) counts.set(s.plan_key, (counts.get(s.plan_key) ?? 0) + 1);
  return Array.from(counts, ([key, count], i) => ({
    label: nameByKey.get(key) ?? key,
    count,
    color: COLORS[i % COLORS.length],
  })).sort((a, b) => b.count - a.count);
}

export async function getTopBusinessTypes(supabase: TypedSupabaseClient, locale = "en"): Promise<CompositionSegment[]> {
  const [{ data: tenants }, { data: types }] = await Promise.all([
    supabase.from("tenants").select("business_type_key"),
    supabase.from("business_types").select("key, name"),
  ]);
  const nameByKey = new Map((types ?? []).map((t) => [t.key, t.name[locale] ?? t.name.en ?? t.key]));
  const counts = new Map<string, number>();
  for (const t of tenants ?? []) counts.set(t.business_type_key, (counts.get(t.business_type_key) ?? 0) + 1);
  return Array.from(counts, ([key, count], i) => ({
    label: nameByKey.get(key) ?? key,
    count,
    color: COLORS[i % COLORS.length],
  }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);
}

export async function getGeographicDistribution(supabase: TypedSupabaseClient): Promise<CompositionSegment[]> {
  const { data: tenants } = await supabase.from("tenants").select("country");
  const counts = new Map<string, number>();
  for (const t of tenants ?? []) {
    const country = t.country?.trim();
    if (!country) continue;
    counts.set(country, (counts.get(country) ?? 0) + 1);
  }
  return Array.from(counts, ([label, count], i) => ({ label, count, color: COLORS[i % COLORS.length] })).sort(
    (a, b) => b.count - a.count,
  );
}

export type RecentSubscriberRow = {
  userId: string;
  name: string;
  email: string | null;
  tenantId: string;
  businessName: string;
  businessTypeLabel: string;
  slug: string;
  planLabel: string | null;
  status: "active" | "trialing" | "past_due" | "canceled" | "no_plan";
  joinedAt: string;
  revenueMinor: number;
  currency: string;
};

export async function getRecentSubscribers(supabase: TypedSupabaseClient, limit = 8, locale = "en"): Promise<RecentSubscriberRow[]> {
  const { data: ownerRole } = await supabase
    .from("roles")
    .select("id")
    .is("tenant_id", null)
    .eq("key", "business_owner")
    .maybeSingle();
  if (!ownerRole) return [];

  const { data: owners } = await supabase
    .from("tenant_members")
    .select("user_id, tenant_id, created_at")
    .eq("role_id", ownerRole.id)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!owners || owners.length === 0) return [];

  const tenantIds = owners.map((o) => o.tenant_id);
  const userIds = owners.map((o) => o.user_id);

  const [
    { data: tenants },
    { data: profiles },
    { data: subscriptions },
    { data: plans },
    { data: businessTypes },
    { data: payments },
  ] = await Promise.all([
    supabase.from("tenants").select("id, slug, business_name, business_type_key, currency").in("id", tenantIds),
    supabase.from("profiles").select("id, full_name, email").in("id", userIds),
    supabase.from("subscriptions").select("tenant_id, plan_key, status").in("tenant_id", tenantIds),
    supabase.from("subscription_plans").select("key, name"),
    supabase.from("business_types").select("key, name"),
    supabase
      .from("subscription_payments")
      .select("tenant_id, amount_minor, status")
      .eq("status", "succeeded")
      .in("tenant_id", tenantIds),
  ]);

  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));
  const planNameByKey = new Map((plans ?? []).map((p) => [p.key, p.name[locale] ?? p.name.en ?? p.key]));
  const typeNameByKey = new Map((businessTypes ?? []).map((t) => [t.key, t.name[locale] ?? t.name.en ?? t.key]));
  const revenueByTenant = new Map<string, number>();
  for (const p of payments ?? [])
    revenueByTenant.set(p.tenant_id, (revenueByTenant.get(p.tenant_id) ?? 0) + p.amount_minor);

  return owners
    .map((owner): RecentSubscriberRow | null => {
      const tenant = tenantById.get(owner.tenant_id);
      if (!tenant) return null;
      const profile = profileById.get(owner.user_id);
      const subscription = subByTenant.get(owner.tenant_id);
      return {
        userId: owner.user_id,
        name: profile?.full_name ?? profile?.email ?? "—",
        email: profile?.email ?? null,
        tenantId: tenant.id,
        businessName: tenant.business_name[locale] ?? tenant.business_name.en ?? tenant.slug,
        businessTypeLabel: typeNameByKey.get(tenant.business_type_key) ?? tenant.business_type_key,
        slug: tenant.slug,
        planLabel: subscription ? (planNameByKey.get(subscription.plan_key) ?? subscription.plan_key) : null,
        status: subscription?.status ?? "no_plan",
        joinedAt: owner.created_at,
        revenueMinor: revenueByTenant.get(owner.tenant_id) ?? 0,
        currency: tenant.currency,
      };
    })
    .filter((r): r is RecentSubscriberRow => r !== null);
}

export type ActivityEvent = {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  at: string;
  actorName: string | null;
};

/** Real platform activity — the same `audit_logs` table every sensitive action in this app already writes to, read platform-wide (spec §12). */
export async function getRecentActivity(supabase: TypedSupabaseClient, limit = 10): Promise<ActivityEvent[]> {
  const { data } = await supabase
    .from("audit_logs")
    .select("id, actor_id, action, entity, entity_id, at")
    .order("at", { ascending: false })
    .limit(limit);
  const rows = data ?? [];
  const actorIds = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => id !== null))];
  const { data: profiles } = actorIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", actorIds)
    : { data: [] };
  const nameById = new Map((profiles ?? []).map((p) => [p.id, p.full_name ?? p.email ?? "Unknown"]));

  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    entity: r.entity,
    entityId: r.entity_id,
    at: r.at,
    actorName: r.actor_id ? (nameById.get(r.actor_id) ?? null) : null,
  }));
}

/** `kind` + `values` word the alert in the Super Admin's language (messages: platform.alerts.*); `message` is its English text. */
export type PlatformAlert = {
  id: string;
  kind: "paymentFailed" | "suspended" | "budgetHit" | "budgetNear" | "anomaly";
  values: Record<string, string | number>;
  message: string;
  severity: "warning" | "critical";
  at: string;
  href: string;
};

/**
 * Real, derivable alert conditions only — failed payments in the last 24h
 * (spec §32's "payment failures"), suspended businesses needing a
 * decision, and any tenant at or approaching a real AI Cost Guard budget
 * (spec §98's Cost Guard — nothing here if no operator has ever set a
 * budget). No notifications table exists yet (spec §57's full center is a
 * later phase), so this is the honest subset that's actually computable
 * today, not a fabricated count.
 */
export async function getPlatformAlerts(supabase: TypedSupabaseClient): Promise<PlatformAlert[]> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: failedPayments }, { data: suspended }, costGuardAlerts, anomalyAlerts] = await Promise.all([
    supabase
      .from("subscription_payments")
      .select("id, tenant_id, created_at")
      .eq("status", "failed")
      .gte("created_at", since),
    supabase.from("tenants").select("id, slug, business_name").eq("status", "suspended"),
    getCostGuardAlerts(supabase),
    getAnomalyAlerts(supabase),
  ]);

  const alerts: PlatformAlert[] = (failedPayments ?? []).map((p) => ({
    id: `payment-${p.id}`,
    kind: "paymentFailed",
    values: {},
    message: "A subscription payment failed in the last 24 hours.",
    severity: "warning",
    at: p.created_at,
    href: "/super-admin/subscribers",
  }));
  for (const tenant of suspended ?? []) {
    alerts.push({
      id: `suspended-${tenant.id}`,
      kind: "suspended",
      values: { business: tenant.business_name.en ?? tenant.slug },
      message: `${tenant.business_name.en ?? tenant.slug} is suspended.`,
      severity: "critical",
      at: new Date().toISOString(),
      href: "/super-admin/businesses",
    });
  }
  for (const guard of costGuardAlerts) {
    alerts.push({
      id: `cost-guard-${guard.tenantId}`,
      kind: guard.severity === "critical" ? "budgetHit" : "budgetNear",
      values: { business: guard.businessName, spent: guard.spentUsd.toFixed(2), budget: guard.budgetUsd.toFixed(2) },
      message:
        guard.severity === "critical"
          ? `${guard.businessName} has hit its AI budget ($${guard.spentUsd.toFixed(2)} of $${guard.budgetUsd.toFixed(2)}) — AI replies are paused for the rest of the month.`
          : `${guard.businessName} is approaching its AI budget ($${guard.spentUsd.toFixed(2)} of $${guard.budgetUsd.toFixed(2)}).`,
      severity: guard.severity,
      at: new Date().toISOString(),
      href: `/super-admin/businesses/${guard.slug}?tab=agent`,
    });
  }
  for (const anomaly of anomalyAlerts) {
    alerts.push({
      id: `anomaly-${anomaly.tenantId}`,
      kind: "anomaly",
      values: { business: anomaly.businessName, count: anomaly.todayCount, usual: anomaly.baselineDailyAvg },
      message: `${anomaly.businessName} has ${anomaly.todayCount} conversations in the last 24h, well above its usual ~${anomaly.baselineDailyAvg}/day — worth a look.`,
      severity: "warning",
      at: new Date().toISOString(),
      href: `/super-admin/businesses/${anomaly.slug}?tab=activity`,
    });
  }
  return alerts.sort((a, b) => (a.at < b.at ? 1 : -1));
}
