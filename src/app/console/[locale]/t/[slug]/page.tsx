import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LineChart } from "@/components/charts/line-chart";
import { DonutChart } from "@/components/console/donut-chart";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { StatusPill } from "@/components/console/status-pill";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { currentUser, requireTenantMember } from "@/server/tenant/context";
import { getTenantDashboardStats } from "@/server/tenant/dashboard-stats";

export default async function TenantDashboard({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console");
  const supabase = await createUserClient();
  const user = await currentUser();

  const [stats, { data: currencyRow }, { data: profile }] = await Promise.all([
    getTenantDashboardStats(supabase, tenant.id, locale),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    user
      ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);
  const firstName = (profile?.full_name ?? "").split(" ")[0] || t("dashboard.fallbackName");

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl bg-gradient-to-br from-emerald-50 via-blue-50 to-violet-50 p-6">
        <h1 className="text-2xl font-semibold text-slate-900">{t("dashboard.greeting", { name: firstName })}</h1>
        <p className="mt-1 text-sm text-slate-600">{t("dashboard.tagline")}</p>
        <form className="mt-4 flex max-w-xl items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
          <input
            disabled
            placeholder={t("dashboard.aiPlaceholder")}
            className="flex-1 bg-transparent text-sm text-slate-500 outline-none placeholder:text-slate-400"
          />
          <span className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-400">
            {t("dashboard.aiSoon")}
          </span>
        </form>
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="orders"
          accent="emerald"
          label={t("dashboard.kpiSales")}
          value={money(stats.totalSalesMinor)}
          trend={stats.trends.sales}
          href={`/${locale}/${slug}/analytics`}
        />
        <KpiTile
          icon="billing"
          accent="blue"
          label={t("dashboard.kpiOrders")}
          value={String(stats.ordersCount)}
          trend={stats.trends.orders}
          href={`/${locale}/${slug}/orders`}
        />
        <KpiTile
          icon="customers"
          accent="purple"
          label={t("dashboard.kpiCustomers")}
          value={String(stats.customersCount)}
          trend={stats.trends.customers}
          href={`/${locale}/${slug}/customers`}
        />
        <KpiTile
          icon="analytics"
          accent="orange"
          label={t("dashboard.kpiAov")}
          value={money(stats.avgOrderValueMinor)}
          trend={stats.trends.avgOrderValue}
          href={`/${locale}/${slug}/analytics`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">
            <Link href={`/${locale}/${slug}/analytics`} prefetch={false} className="hover:underline">
              {t("dashboard.salesOverview")}
            </Link>
          </h2>
          <p className="mb-3 text-xs text-slate-500">{t("dashboard.salesOverviewSubtitle")}</p>
          {stats.ordersCount > 0 ? (
            <LineChart
              data={stats.salesSeries.map((point) => ({ date: point.date, count: point.totalMinor }))}
              label={t("dashboard.kpiSales")}
              format={{ kind: "currency", currency: tenant.currency, exponent, locale }}
            />
          ) : (
            <EmptyState
              title={t("dashboard.noSalesTitle")}
              description={t("dashboard.noSalesDescription")}
              actionLabel={t("dashboard.noSalesAction")}
              actionHref={`/${locale}/${slug}/products`}
            />
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">
            <Link href={`/${locale}/${slug}/orders`} prefetch={false} className="hover:underline">
              {t("dashboard.ordersByStatus")}
            </Link>
          </h2>
          {stats.ordersCount > 0 ? (
            <DonutChart segments={stats.ordersByStatusGroup} centerLabel={t("dashboard.kpiOrders")} />
          ) : (
            <p className="text-sm text-slate-500">{t("dashboard.noOrdersYet")}</p>
          )}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.recentOrders")}</h2>
            <Link
              href={`/${locale}/${slug}/orders`}
              prefetch={false}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          {stats.recentOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-start font-medium">#</th>
                    <th className="py-2 text-start font-medium">{t("dashboard.customer")}</th>
                    <th className="py-2 text-start font-medium">{t("dashboard.total")}</th>
                    <th className="py-2 text-start font-medium">{t("dashboard.status")}</th>
                    <th className="py-2 text-start font-medium">{t("dashboard.date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentOrders.map((order) => (
                    <tr key={order.id} className="border-b border-slate-100">
                      <td className="py-2 font-medium text-slate-900">#{order.orderNumber}</td>
                      <td className="py-2 text-slate-700">{order.customerName ?? "—"}</td>
                      <td className="py-2 text-slate-700">{money(order.totalMinor)}</td>
                      <td className="py-2">
                        <StatusPill status={order.status} />
                      </td>
                      <td className="py-2 text-slate-500">{new Date(order.createdAt).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={t("dashboard.noOrdersTitle")}
              description={t("dashboard.noOrdersDescription")}
              actionLabel={t("dashboard.noSalesAction")}
              actionHref={`/${locale}/${slug}/products`}
            />
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.recentConversations")}</h2>
            <Link
              href={`/${locale}/${slug}/conversations`}
              prefetch={false}
              className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          {stats.recentConversations.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {stats.recentConversations.map((conversation) => (
                <li key={conversation.id} className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">
                    {conversation.channel === "external_agent"
                      ? t("dashboard.channelAgent")
                      : t("dashboard.channelWidget")}
                    <span className="ms-2 text-xs capitalize text-slate-400">({conversation.status})</span>
                  </span>
                  <span className="text-xs text-slate-400">
                    {conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleDateString(locale) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title={t("dashboard.noConversationsTitle")}
              description={t("dashboard.noConversationsDescription")}
              actionLabel={t("dashboard.noConversationsAction")}
              actionHref={`/${locale}/${slug}/agent`}
            />
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t("dashboard.topProducts")}</h2>
          <Link
            href={`/${locale}/${slug}/products`}
            prefetch={false}
            className="text-xs font-medium text-emerald-600 hover:text-emerald-700"
          >
            {t("dashboard.viewAll")}
          </Link>
        </div>
        {stats.topProducts.length > 0 ? (
          <ol className="flex flex-col gap-3">
            {stats.topProducts.map((product, index) => (
              <li key={product.name} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                    {index + 1}
                  </span>
                  <span className="text-slate-800">{product.name}</span>
                </span>
                <span className="flex items-center gap-3 text-slate-500">
                  <span>{product.quantity} sold</span>
                  <span className="font-medium text-slate-900">{money(product.revenueMinor)}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState
            title={t("dashboard.noProductsSoldTitle")}
            description={t("dashboard.noProductsSoldDescription")}
            actionLabel={t("dashboard.noSalesAction")}
            actionHref={`/${locale}/${slug}/products`}
          />
        )}
      </section>
    </div>
  );
}
