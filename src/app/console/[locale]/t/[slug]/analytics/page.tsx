import Link from "next/link";

import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/console/donut-chart";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import { ANALYTICS_RANGES, getTenantAnalytics, type AnalyticsRangeDays } from "@/server/tenant/analytics-stats";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { Msg } from "@/components/i18n/msg";

function parseRange(value: string | undefined): AnalyticsRangeDays {
  const parsed = Number(value);
  return (ANALYTICS_RANGES as readonly number[]).includes(parsed) ? (parsed as AnalyticsRangeDays) : 30;
}

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ range?: string }>;
}) {
  const { locale, slug } = await params;
  const { range: rangeParam } = await searchParams;
  const rangeDays = parseRange(rangeParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.analytics");
  const tAll = await getTranslations();
  const trendLabel = <Msg id="console.kpi.vsPriorDays" values={{ days: rangeDays }} />;
  const named = (group: string) => (key: string, fallback: string) => (tAll.has(`${group}.${key}`) ? tAll(`${group}.${key}`) : fallback);

  const [analytics, { data: currencyRow }] = await Promise.all([
    getTenantAnalytics(supabase, tenant.id, locale, rangeDays),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const baseHref = `/${locale}/${slug}/analytics`;
  const tabs: Tab[] = ANALYTICS_RANGES.map((days) => ({
    key: String(days),
    label: t("range", { days }),
    href: days === 30 ? baseHref : `${baseHref}?range=${days}`,
    active: rangeDays === days,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <Tabs tabs={tabs} />
      </div>

      {analytics.ordersCount === 0 && analytics.funnel.conversationsStarted === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          actionLabel={t("setUpAgent")}
          actionHref={`/${locale}/${slug}/agent`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile
              icon="analytics"
              accent="emerald"
              label={t("sales")}
              value={money(analytics.totalSalesMinor)}
              trend={analytics.trends.sales}
              trendLabel={trendLabel}
          href={`/${locale}/${slug}/orders?status=completed`}
        />
            <KpiTile
              icon="orders"
              accent="blue"
              label={t("orders")}
              value={String(analytics.ordersCount)}
              trend={analytics.trends.orders}
              trendLabel={trendLabel}
          href={`/${locale}/${slug}/orders`}
        />
            <KpiTile
              icon="billing"
              accent="purple"
              label={t("aov")}
              value={money(analytics.avgOrderValueMinor)}
              trend={analytics.trends.avgOrderValue}
              trendLabel={trendLabel}
          href={`/${locale}/${slug}/orders`}
        />
            <KpiTile
              icon="conversations"
              accent="orange"
              label={t("conversations")}
              value={String(analytics.funnel.conversationsStarted)}
              trend={null}
              href={`/${locale}/${slug}/conversations`}
            />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              <Link href={`/${locale}/${slug}/conversations`} prefetch={false} className="hover:underline">
                {t("funnelTitle")}
              </Link>
            </h2>
            <div className="flex flex-col gap-2">
              {(
                [
                  { label: t("funnel.started"), value: analytics.funnel.conversationsStarted },
                  { label: t("funnel.cart"), value: analytics.funnel.cartsStarted },
                  { label: t("funnel.placed"), value: analytics.funnel.ordersPlaced },
                  { label: t("funnel.settled"), value: analytics.funnel.ordersSettled },
                ] as const
              ).map((stage, i, all) => {
                const base = all[0].value || 1;
                const widthPct = Math.max(4, Math.round((stage.value / base) * 100));
                return (
                  <div key={stage.label} className="flex items-center gap-3 text-sm">
                    <span className="w-44 shrink-0 text-slate-600">{stage.label}</span>
                    <div className="h-6 flex-1 rounded-full bg-slate-100">
                      <div
                        className="h-6 rounded-full bg-emerald-500"
                        style={{ width: `${Math.min(100, widthPct)}%` }}
                      />
                    </div>
                    <span className="w-12 shrink-0 text-end font-medium text-slate-900">{stage.value}</span>
                    {i > 0 && all[0].value > 0 && (
                      <span className="w-14 shrink-0 text-end text-xs text-slate-400">
                        {Math.round((stage.value / all[0].value) * 100)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              <Link href={`/${locale}/${slug}/orders?status=completed`} prefetch={false} className="hover:underline">
                {t("salesOverTime")}
              </Link>
            </h2>
            {analytics.totalSalesMinor > 0 ? (
              <LineChart
                data={analytics.salesSeries}
                label={t("sales")}
                format={{ kind: "currency", currency: tenant.currency, exponent, locale }}
              />
            ) : (
              <p className="text-sm text-slate-500">{t("noSales")}</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                <Link href={`/${locale}/${slug}/orders`} prefetch={false} className="hover:underline">
                  {t("ordersByStatus")}
                </Link>
              </h2>
              {analytics.ordersCount > 0 ? (
                <DonutChart segments={analytics.ordersByStatusGroup.map((s) => ({ ...s, label: named("common.orderGroup")(s.key, s.label) }))} centerLabel={t("orders")} />
              ) : (
                <p className="text-sm text-slate-500">{t("noOrders")}</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                <Link href={`/${locale}/${slug}/orders`} prefetch={false} className="hover:underline">
                  {t("howPaid")}
                </Link>
              </h2>
              {analytics.paymentMethodBreakdown.length > 0 ? (
                <DonutChart segments={analytics.paymentMethodBreakdown.map((s) => ({ ...s, label: named("common.paymentProvider")(s.key, s.label) }))} centerLabel={t("orders")} />
              ) : (
                <p className="text-sm text-slate-500">{t("noPaid")}</p>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              <Link href={`/${locale}/${slug}/products`} prefetch={false} className="hover:underline">
                {t("topProducts")}
              </Link>
            </h2>
            {analytics.topProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 text-start font-medium">{t("product")}</th>
                      <th className="py-2 text-start font-medium">{t("quantity")}</th>
                      <th className="py-2 text-start font-medium">{t("revenue")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {analytics.topProducts.map((product) => (
                      <tr key={product.name} className="border-b border-slate-100 last:border-0">
                        <td className="py-2 font-medium text-slate-900">{product.name}</td>
                        <td className="py-2 text-slate-600">{product.quantity}</td>
                        <td className="py-2 text-slate-600">{money(product.revenueMinor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-slate-500">{t("noProductSales")}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
