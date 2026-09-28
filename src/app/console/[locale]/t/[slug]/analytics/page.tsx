import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/console/donut-chart";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import { ANALYTICS_RANGES, getTenantAnalytics, type AnalyticsRangeDays } from "@/server/tenant/analytics-stats";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const RANGE_LABEL: Record<AnalyticsRangeDays, string> = { 7: "7 days", 30: "30 days", 90: "90 days" };

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

  const [analytics, { data: currencyRow }] = await Promise.all([
    getTenantAnalytics(supabase, tenant.id, locale, rangeDays),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const baseHref = `/${locale}/t/${slug}/analytics`;
  const tabs: Tab[] = ANALYTICS_RANGES.map((days) => ({
    key: String(days),
    label: RANGE_LABEL[days],
    href: days === 30 ? baseHref : `${baseHref}?range=${days}`,
    active: rangeDays === days,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Analytics</h1>
        <Tabs tabs={tabs} />
      </div>

      {analytics.ordersCount === 0 && analytics.aiCostUsd === 0 ? (
        <EmptyState
          title="No activity in this period"
          description="Sales, orders, and AI usage will appear here once your Agent starts taking orders."
          actionLabel="Set up your Agent"
          actionHref={`/${locale}/t/${slug}/agent`}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile
              icon="analytics"
              accent="emerald"
              label="Sales"
              value={money(analytics.totalSalesMinor)}
              trend={analytics.trends.sales}
              trendLabel={`vs prior ${rangeDays} days`}
            />
            <KpiTile
              icon="orders"
              accent="blue"
              label="Orders"
              value={String(analytics.ordersCount)}
              trend={analytics.trends.orders}
              trendLabel={`vs prior ${rangeDays} days`}
            />
            <KpiTile
              icon="billing"
              accent="purple"
              label="Avg. order value"
              value={money(analytics.avgOrderValueMinor)}
              trend={analytics.trends.avgOrderValue}
              trendLabel={`vs prior ${rangeDays} days`}
            />
            <KpiTile
              icon="agent"
              accent="orange"
              label="AI cost"
              value={`$${analytics.aiCostUsd.toFixed(4)}`}
              trend={analytics.trends.aiCost}
              trendLabel={`vs prior ${rangeDays} days`}
            />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Sales over time</h2>
            {analytics.totalSalesMinor > 0 ? (
              <LineChart data={analytics.salesSeries} label="Sales" formatValue={money} formatAxis={money} />
            ) : (
              <p className="text-sm text-slate-500">No sales recorded in this period yet.</p>
            )}
          </section>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">Orders by status</h2>
              {analytics.ordersCount > 0 ? (
                <DonutChart segments={analytics.ordersByStatusGroup} centerLabel="Orders" />
              ) : (
                <p className="text-sm text-slate-500">No orders in this period yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">How customers paid</h2>
              {analytics.paymentMethodBreakdown.length > 0 ? (
                <DonutChart segments={analytics.paymentMethodBreakdown} centerLabel="Orders" />
              ) : (
                <p className="text-sm text-slate-500">No paid or in-progress orders in this period yet.</p>
              )}
            </section>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Top products</h2>
            {analytics.topProducts.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-start text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500">
                      <th className="py-2 text-start font-medium">Product</th>
                      <th className="py-2 text-start font-medium">Quantity sold</th>
                      <th className="py-2 text-start font-medium">Revenue</th>
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
              <p className="text-sm text-slate-500">No product sales in this period yet.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
