import Link from "next/link";
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
import { getTranslations } from "next-intl/server";
import { RichMsg } from "@/components/i18n/msg";
import { auditActionLabel, statusLabel } from "@/lib/i18n-labels";

const METRICS: GrowthMetric[] = ["subscribers", "businesses", "revenue", "conversations"];
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
  const t = await getTranslations("platform.overview");
  const tAll = await getTranslations();

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
    getSubscribersByPlan(supabase, locale),
    getTopBusinessTypes(supabase, locale),
    getGeographicDistribution(supabase),
    getRecentSubscribers(supabase, 8, locale),
    getRecentActivity(supabase),
    getPlatformAgentStats(supabase, 30),
    getSystemHealth(supabase),
  ]);
  const { data: currencyRow } = kpis.monthlyRevenueCurrency
    ? await supabase.from("currencies").select("exponent").eq("code", kpis.monthlyRevenueCurrency).maybeSingle()
    : { data: null };
  const revenueExponent = currencyRow?.exponent ?? 2;
  const firstName = profile?.full_name?.split(" ")[0] ?? tAll("platform.shell.superAdmin");
  const status = overallHealth(health);

  const baseHref = `/${locale}/super-admin`;
  const metricTabs: Tab[] = METRICS.map((m) => ({
    key: m,
    label: t(`metric.${m}`),
    href: `${baseHref}?metric=${m}&range=${rangeDays}`,
    active: metric === m,
  }));
  const rangeTabs: Tab[] = GROWTH_RANGES.map((r) => ({
    key: String(r),
    label: t(`range.${r}`),
    href: `${baseHref}?metric=${metric}&range=${r}`,
    active: rangeDays === r,
  }));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-violet-50 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Image src="/brand/logo-mark.png" alt="" width={56} height={56} className="hidden rounded-xl sm:block" />
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">{t("welcome", { name: firstName })}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {t("subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_DOT[status]}`} />
          <p className="text-sm text-slate-700">
            <RichMsg id="platform.overview.platformIs" values={{ status: t(`health.${status}`), b: (c) => <span className="font-medium">{c}</span> }} />
            {kpis.monthlyRevenueTrend &&
              kpis.monthlyRevenueTrend.direction === "up" &&
              t("revenueUp", { pct: kpis.monthlyRevenueTrend.pct })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          icon="customers"
          accent="emerald"
          label={t("kpi.subscribers")}
          value={String(kpis.totalSubscribers)}
          trend={kpis.totalSubscribersTrend}
          href={`/${locale}/super-admin/subscribers`}
        />
        <KpiTile
          icon="building"
          accent="blue"
          label={t("kpi.businesses")}
          value={String(kpis.totalBusinesses)}
          trend={kpis.totalBusinessesTrend}
          href={`/${locale}/super-admin/businesses`}
        />
        <KpiTile
          icon="agent"
          accent="emerald"
          label={t("kpi.agents")}
          value={String(kpis.activeAgents)}
          trend={null}
          href={`/${locale}/super-admin/ai-agents`}
        />
        <KpiTile
          icon="billing"
          accent="orange"
          label={t("kpi.revenue")}
          value={
            kpis.monthlyRevenueCurrency
              ? formatMoney(kpis.monthlyRevenueMinor, kpis.monthlyRevenueCurrency, revenueExponent, locale)
              : "—"
          }
          trend={kpis.monthlyRevenueTrend}
          href={`/${locale}/super-admin/payments`}
        />
        <KpiTile
          icon="conversations"
          accent="blue"
          label={t("kpi.conversations")}
          value={String(kpis.totalConversations)}
          trend={kpis.totalConversationsTrend}
          href={`/${locale}/super-admin/usage`}
        />
        <KpiTile
          icon="marketing"
          accent="purple"
          label={t("kpi.subscriptions")}
          value={String(kpis.activeSubscriptions)}
          trend={kpis.activeSubscriptionsTrend}
          href={`/${locale}/super-admin/subscribers?status=active`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-900">
              <Link href={`/${locale}/super-admin/analytics`} prefetch={false} className="hover:underline">
                {t("growth")}
              </Link>
            </h2>
            <Tabs tabs={rangeTabs} />
          </div>
          <Tabs tabs={metricTabs} />
          <div className="mt-3">
            {growthSeries.some((p) => p.count > 0) ? (
              <LineChart
                data={growthSeries}
                label={t(`metric.${metric}`)}
                format={
                  metric === "revenue"
                    ? {
                        kind: "currency",
                        currency: kpis.monthlyRevenueCurrency ?? "USD",
                        exponent: revenueExponent,
                        locale,
                      }
                    : { kind: "number" }
                }
              />
            ) : (
              <p className="py-10 text-center text-sm text-slate-400">{t("noActivity", { metric: t(`metric.${metric}`) })}</p>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("byPlan")}</h2>
            <Link href={`/${locale}/super-admin/plans`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("view")}
            </Link>
          </div>
          {subscribersByPlan.length > 0 ? (
            <DonutChart segments={subscribersByPlan} centerLabel={t("total")} />
          ) : (
            <p className="py-6 text-center text-sm text-slate-400">{t("noSubscriptions")}</p>
          )}
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("topTypes")}</h2>
            <Link href={`/${locale}/super-admin/businesses`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("view")}
            </Link>
          </div>
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
            <p className="py-6 text-center text-sm text-slate-400">{t("noBusinesses")}</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("geo")}</h2>
            <Link href={`/${locale}/super-admin/businesses`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("view")}
            </Link>
          </div>
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
            <p className="py-6 text-center text-sm text-slate-400">{t("noGeo")}</p>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("aiUsage")}</h2>
            <Link href={`/${locale}/super-admin/usage`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("view")}
            </Link>
          </div>
          <dl className="flex flex-col gap-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">{t("interactions")}</dt>
              <dd className="text-lg font-semibold text-slate-900">{aiUsage.total}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">{t("withoutAi")}</dt>
              <dd className="text-lg font-semibold text-slate-900">{aiUsage.deterministicPct}%</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-500">{t("aiCost")}</dt>
              <dd className="text-lg font-semibold text-slate-900">${aiUsage.totalCostUsd.toFixed(4)}</dd>
            </div>
          </dl>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t("recentSubscribers")}</h2>
            <Link
              href={`/${locale}/super-admin/subscribers`}
              prefetch={false}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              {t("viewAll")}
            </Link>
          </div>
          {recentSubscribers.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-start font-medium">{t("col.subscriber")}</th>
                    <th className="py-2 text-start font-medium">{t("col.business")}</th>
                    <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                    <th className="py-2 text-start font-medium">{t("col.status")}</th>
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
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
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
                          {statusLabel(tAll, s.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={t("noSubscribers")}
              description={t("noSubscribersDescription")}
            />
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">{t("recentActivity")}</h2>
            <Link href={`/${locale}/super-admin/audit-logs`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("view")}
            </Link>
          </div>
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
                        <span className="font-medium text-slate-900">{auditActionLabel(tAll, event.action)}</span>
                        {event.actorName && <span className="text-slate-500">{tAll("common.byActor", { name: event.actorName })}</span>}
                      </p>
                      <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString(locale)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              title={t("noActivityTitle")}
              description={t("noActivityDescription")}
            />
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t("quickActions")}</h2>
          <Link
            href={`/${locale}/super-admin/system-health`}
            prefetch={false}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            {t("viewHealth")}
          </Link>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/${locale}/super-admin/models`}
            prefetch={false}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            {t("configureModel")}
          </Link>
          <Link
            href={`/${locale}/super-admin/admins`}
            prefetch={false}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("addAdmin")}
          </Link>
          <Link
            href={`/${locale}/super-admin/audit-logs`}
            prefetch={false}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            {t("openAudit")}
          </Link>
        </div>
      </section>
    </div>
  );
}
