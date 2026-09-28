import Image from "next/image";

import { DonutChart } from "@/components/console/donut-chart";
import { EmptyState } from "@/components/console/empty-state";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { KpiTile } from "@/components/console/kpi-tile";
import { LineChart } from "@/components/charts/line-chart";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import {
  getGeographicDistribution,
  getPlatformGrowthSeries,
  getPlatformKpis,
  getRecentActivity,
  getRecentSubscribers,
  getSubscribersByPlan,
  getTopBusinessTypes,
  GROWTH_RANGES,
  type GrowthMetric,
  type GrowthRangeDays,
} from "@/server/platform/dashboard-stats";
import { getSystemHealth, overallHealth } from "@/server/platform/health";
import { getPlatformAgentStats } from "@/server/platform/stats";
import { createUserClient } from "@/server/supabase/clients";
import { currentUser, requireSuperAdmin } from "@/server/tenant/context";

const METRICS: { key: GrowthMetric; label: string }[] = [
  { key: "subscribers", label: "Subscribers" },
  { key: "businesses", label: "Businesses" },
  { key: "revenue", label: "Revenue" },
  { key: "conversations", label: "Conversations" },
];
const RANGE_LABEL: Record<GrowthRangeDays, string> = { 30: "30 days", 90: "90 days", 365: "12 months" };
const HEALTH_DOT: Record<string, string> = {
  operational: "bg-emerald-500",
  degraded: "bg-amber-500",
  critical: "bg-red-500",
};
const ACTIVITY_ICON: Record<string, { icon: "customers" | "billing" | "agent" | "audit"; accent: string }> = {
  "tenant.created": { icon: "customers", accent: "bg-emerald-50 text-emerald-600" },
  "subscription.activated": { icon: "billing", accent: "bg-blue-50 text-blue-600" },
  "order.created": { icon: "billing", accent: "bg-blue-50 text-blue-600" },
};

function parseMetric(value: string | undefined): GrowthMetric {
  return (["subscribers", "businesses", "revenue", "conversations"] as const).includes(value as GrowthMetric)
    ? (value as GrowthMetric)
    : "subscribers";
}
function parseRange(value: string | undefined): GrowthRangeDays {
  const n = Number(value);
  return (GROWTH_RANGES as readonly number[]).includes(n) ? (n as GrowthRangeDays) : 30;
}

export default async function SuperAdminDashboard({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ metric?: string; range?: string }>;
}) {
  const { locale } = await params;
  const { metric: metricParam, range: rangeParam } = await searchParams;
  await requireSuperAdmin(locale);
  const metric = parseMetric(metricParam);
  const rangeDays = parseRange(rangeParam);

  const user = await currentUser();
  const supabase = await createUserClient();

  const [
    { data: profile },
    kpis,
    growthSeries,
    subscribersByPlan,
    topBusinessTypes,
    geographic,
    recentSubscribers,
    recentActivity,
    aiUsage,
    health,
  ] = await Promise.all([
    user
      ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    getPlatformKpis(supabase),
    getPlatformGrowthSeries(supabase, metric, rangeDays),
    getSubscribersByPlan(supabase),
    getTopBusinessTypes(supabase),
    getGeographicDistribution(supabase),
    getRecentSubscribers(supabase),
    getRecentActivity(supabase),
    getPlatformAgentStats(supabase, 30),
    getSystemHealth(supabase),
  ]);
  const { data: currencyRow } = kpis.monthlyRevenueCurrency
    ? await supabase.from("currencies").select("exponent").eq("code", kpis.monthlyRevenueCurrency).maybeSingle()
    : { data: null };
  const revenueExponent = currencyRow?.exponent ?? 2;
  const firstName = profile?.full_name?.split(" ")[0] ?? "Super Admin";
  const status = overallHealth(health);

  const baseHref = `/${locale}/super-admin`;
  const metricTabs: Tab[] = METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    href: `${baseHref}?metric=${m.key}&range=${rangeDays}`,
    active: metric === m.key,
  }));
  const rangeTabs: Tab[] = GROWTH_RANGES.map((r) => ({
    key: String(r),
    label: RANGE_LABEL[r],
    href: `${baseHref}?metric=${metric}&range=${r}`,
    active: rangeDays === r,
  }));

  const formatSeriesValue = (value: number) =>
    metric === "revenue"
      ? formatMoney(value, kpis.monthlyRevenueCurrency ?? "USD", revenueExponent, locale)
      : String(value);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-violet-50 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/brand/logo-mark.png" alt="" width={56} height={56} className="hidden rounded-xl sm:block" />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Welcome back, {firstName}! 👋</h1>
            <p className="mt-1 text-sm text-slate-600">
              Here&apos;s what&apos;s happening with your SmartManager AI Agent platform.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[status]}`} />
          <p className="text-sm text-slate-700">
            Platform is <span className="font-medium capitalize">{status}</span>
            {kpis.monthlyRevenueTrend &&
              kpis.monthlyRevenueTrend.direction === "up" &&
              ` — revenue up ${kpis.monthlyRevenueTrend.pct}% this month`}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          icon="customers"
          accent="emerald"
          label="Total Subscribers"
          value={String(kpis.totalSubscribers)}
          trend={kpis.totalSubscribersTrend}
        />
        <KpiTile
          icon="building"
          accent="blue"
          label="Total Businesses"
          value={String(kpis.totalBusinesses)}
          trend={kpis.totalBusinessesTrend}
        />
        <KpiTile
          icon="agent"
          accent="emerald"
          label="AI Agents Active"
          value={String(kpis.activeAgents)}
          trend={null}
        />
        <KpiTile
          icon="billing"
          accent="orange"
          label="Monthly Revenue"
          value={
            kpis.monthlyRevenueCurrency
              ? formatMoney(kpis.monthlyRevenueMinor, kpis.monthlyRevenueCurrency, revenueExponent, locale)
              : "—"
          }
          trend={kpis.monthlyRevenueTrend}
        />
        <KpiTile
          icon="conversations"
          accent="blue"
          label="Total Conversations"
          value={String(kpis.totalConversations)}
          trend={kpis.totalConversationsTrend}
        />
        <KpiTile
          icon="marketing"
          accent="purple"
          label="Active Subscriptions"
          value={String(kpis.activeSubscriptions)}
          trend={kpis.activeSubscriptionsTrend}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">Platform Growth</h2>
            <Tabs tabs={rangeTabs} />
          </div>
          <Tabs tabs={metricTabs} />
          <div className="mt-3">
            {growthSeries.some((p) => p.count > 0) ? (
              <LineChart
                data={growthSeries}
                label={METRICS.find((m) => m.key === metric)?.label ?? ""}
                formatValue={formatSeriesValue}
                formatAxis={formatSeriesValue}
              />
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">No {metric} activity in this period yet.</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscribers by Plan</h2>
          {subscribersByPlan.length > 0 ? (
            <DonutChart segments={subscribersByPlan} centerLabel="Total" />
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">No active subscriptions yet.</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Top Business Types</h2>
          {topBusinessTypes.length > 0 ? (
            <ul className="flex flex-col gap-2.5 text-sm">
              {topBusinessTypes.map((type) => {
                const total = topBusinessTypes.reduce((sum, t) => sum + t.count, 0);
                return (
                  <li key={type.label} className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: type.color }} />
                      {type.label}
                    </span>
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      {type.count}
                      <span className="text-xs font-normal text-slate-400">
                        {total > 0 ? `${Math.round((type.count / total) * 100)}%` : "0%"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">No businesses yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Geographic Distribution</h2>
          {geographic.length > 0 ? (
            <ul className="flex flex-col gap-2.5 text-sm">
              {geographic.map((g) => {
                const total = geographic.reduce((sum, x) => sum + x.count, 0);
                return (
                  <li key={g.label} className="flex items-center justify-between gap-3">
                    <span className="text-slate-600">{g.label}</span>
                    <span className="flex items-center gap-2 font-medium text-slate-900">
                      {g.count}
                      <span className="text-xs font-normal text-slate-400">
                        {total > 0 ? `${Math.round((g.count / total) * 100)}%` : "0%"}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">No country data recorded yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">AI Usage (30d)</h2>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">Interactions</dt>
              <dd className="text-lg font-semibold text-slate-900">{aiUsage.total}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">Handled without AI</dt>
              <dd className="text-lg font-semibold text-slate-900">{aiUsage.deterministicPct}%</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">Total AI cost</dt>
              <dd className="text-lg font-semibold text-slate-900">${aiUsage.totalCostUsd.toFixed(4)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent Subscribers</h2>
            <a
              href={`/${locale}/super-admin/subscribers`}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              View all
            </a>
          </div>
          {recentSubscribers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-start font-medium">Subscriber</th>
                    <th className="py-2 text-start font-medium">Business</th>
                    <th className="py-2 text-start font-medium">Plan</th>
                    <th className="py-2 text-start font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSubscribers.map((s) => (
                    <tr key={s.userId} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-medium text-slate-900">{s.name}</td>
                      <td className="py-2 text-slate-600">{s.businessName}</td>
                      <td className="py-2 text-slate-600">{s.planLabel ?? "—"}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                            s.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : s.status === "trialing"
                                ? "bg-blue-50 text-blue-700"
                                : s.status === "past_due"
                                  ? "bg-amber-50 text-amber-700"
                                  : s.status === "canceled"
                                    ? "bg-red-50 text-red-700"
                                    : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {s.status.replace("_", " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No subscribers yet"
              description="They'll appear here once the first business signs up."
            />
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Recent Platform Activity</h2>
          {recentActivity.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {recentActivity.map((event) => {
                const meta = ACTIVITY_ICON[event.action] ?? {
                  icon: "audit" as const,
                  accent: "bg-slate-100 text-slate-500",
                };
                return (
                  <li key={event.id} className="flex items-start gap-3 text-sm">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${meta.accent}`}>
                      <Icon path={NAV_ICON_PATHS[meta.icon]} size={14} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-slate-700">
                        <span className="font-medium capitalize text-slate-900">
                          {event.action.replace(/[._]/g, " ")}
                        </span>
                        {event.actorName && <span className="text-slate-500"> by {event.actorName}</span>}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString(locale)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title="No activity yet"
              description="Sensitive platform actions will show up here as they happen."
            />
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Quick Actions</h2>
          <a
            href={`/${locale}/super-admin/system-health`}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            View System Health →
          </a>
        </div>
        <div className="flex flex-wrap gap-3">
          <a
            href={`/${locale}/super-admin/models`}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            Configure AI Model
          </a>
          <a
            href={`/${locale}/super-admin/admins`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Add Admin
          </a>
          <a
            href={`/${locale}/super-admin/audit-logs`}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open Audit Logs
          </a>
        </div>
      </section>
    </div>
  );
}
