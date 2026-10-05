import "server-only";

import { ORDER_STATUS_GROUP_COLOR, orderStatusGroup } from "@/lib/order-status";
import { timed } from "@/server/perf";
import type { Trend } from "@/server/tenant/dashboard-stats";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGES)[number];

const PAYMENT_METHOD_COLOR: Record<string, string> = {
  moyasar: "#3b82f6",
  tap: "#8b5cf6",
  stripe: "#6366f1",
  paypal: "#0ea5e9",
  hyperpay: "#f59e0b",
  myfatoorah: "#ec4899",
  cash: "#10b981",
};

export type TenantAnalytics = {
  rangeDays: AnalyticsRangeDays;
  totalSalesMinor: number;
  ordersCount: number;
  avgOrderValueMinor: number;
  trends: { sales: Trend; orders: Trend; avgOrderValue: Trend };
  salesSeries: { date: string; count: number }[];
  /** `key` is the status group / payment provider (pages word it in the user's language); `label` is its English name. */
  ordersByStatusGroup: { key: string; label: string; count: number; color: string }[];
  topProducts: { name: string; quantity: number; revenueMinor: number }[];
  paymentMethodBreakdown: { key: string; label: string; count: number; color: string }[];
  /** Real conversion funnel for this window — each stage counted from its own table, never derived from the next. */
  funnel: { conversationsStarted: number; cartsStarted: number; ordersPlaced: number; ordersSettled: number };
};

function trend(current: number, prior: number): Trend {
  if (prior === 0) return null;
  const pct = Math.round(((current - prior) / prior) * 1000) / 10;
  return { pct: Math.abs(pct), direction: pct >= 0 ? "up" : "down" };
}

/**
 * Real, tenant-scoped analytics for a selectable window — same "no
 * fabricated numbers" rule as the Dashboard: `paymentMethodBreakdown` is
 * derived from actual `payments` rows (an order with a succeeded payment
 * used that provider; one with none but a paid/active status was settled
 * in person — cash on delivery or pay on table, both write no `payments`
 * row) rather than a column this schema doesn't have.
 */
export async function getTenantAnalytics(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  rangeDays: AnalyticsRangeDays,
): Promise<TenantAnalytics> {
  // Every aggregate below is computed in Postgres (`tenant_analytics_stats`,
  // SECURITY INVOKER — the same RLS as a direct select) instead of
  // downloading every order and AI interaction in the comparison window
  // and then re-querying their items/payments by id list. The trend,
  // rounding, status-group and label logic is unchanged.
  const { data: a, error } = await timed(
    "analytics.queries",
    supabase.rpc("tenant_analytics_stats", { p_tenant_id: tenantId, p_locale: locale, p_range_days: rangeDays }),
  );
  if (error) throw new Error(`Failed to load analytics: ${error.message}`);

  const totalSalesMinor = Number(a?.current_sales_minor ?? 0);
  const ordersCount = Number(a?.current_orders ?? 0);
  const avgOrderValueMinor = ordersCount > 0 ? Math.round(totalSalesMinor / ordersCount) : 0;

  const priorSales = Number(a?.prior_sales_minor ?? 0);
  const priorOrdersCount = Number(a?.prior_orders ?? 0);
  const priorAov = priorOrdersCount > 0 ? priorSales / priorOrdersCount : 0;

  const trends = {
    sales: trend(totalSalesMinor, priorSales),
    orders: trend(ordersCount, priorOrdersCount),
    avgOrderValue: trend(avgOrderValueMinor, priorAov),
  };

  const now = Date.now();
  const days: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const salesByDay = a?.sales_by_day ?? {};
  const salesSeries = days.map((date) => ({ date, count: Number(salesByDay[date] ?? 0) }));

  const groupCounts: Record<string, number> = { pending: 0, active: 0, completed: 0, cancelled: 0 };
  for (const [status, count] of Object.entries(a?.status_counts ?? {})) {
    const group = orderStatusGroup(status);
    groupCounts[group] = (groupCounts[group] ?? 0) + Number(count);
  }
  const ordersByStatusGroup = (["pending", "active", "completed", "cancelled"] as const).map((group) => ({
    key: group,
    label: group.charAt(0).toUpperCase() + group.slice(1),
    count: groupCounts[group],
    color: ORDER_STATUS_GROUP_COLOR[group],
  }));

  const topProducts = (a?.top_products ?? []).map((p) => ({
    name: p.name,
    quantity: Number(p.quantity),
    revenueMinor: Number(p.revenue_minor),
  }));

  const paymentMethodBreakdown = Object.entries(a?.payment_methods ?? {})
    .map(([provider, count]) => ({
      key: provider,
      label: provider === "cash" ? "Cash / in-person" : provider.charAt(0).toUpperCase() + provider.slice(1),
      count: Number(count),
      color: PAYMENT_METHOD_COLOR[provider] ?? "#f59e0b",
    }))
    .sort((x, y) => y.count - x.count);

  return {
    rangeDays,
    totalSalesMinor,
    ordersCount,
    avgOrderValueMinor,
    trends,
    salesSeries,
    ordersByStatusGroup,
    topProducts,
    paymentMethodBreakdown,
    funnel: {
      conversationsStarted: Number(a?.conversations_started ?? 0),
      cartsStarted: Number(a?.carts_started ?? 0),
      ordersPlaced: ordersCount,
      ordersSettled: Number(a?.settled_orders ?? 0),
    },
  };
}
