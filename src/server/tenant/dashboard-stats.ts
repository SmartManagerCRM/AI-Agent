import "server-only";

import { ORDER_STATUS_GROUP_COLOR, orderStatusGroup } from "@/lib/order-status";
import { timed } from "@/server/perf";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const WINDOW_DAYS = 30;

export type Trend = { pct: number; direction: "up" | "down" } | null;

export type DashboardStats = {
  totalSalesMinor: number;
  ordersCount: number;
  customersCount: number;
  avgOrderValueMinor: number;
  conversationsCount: number;
  productsCount: number;
  trends: { sales: Trend; orders: Trend; customers: Trend; avgOrderValue: Trend };
  salesSeries: { date: string; totalMinor: number }[];
  ordersByStatusGroup: { label: string; count: number; color: string }[];
  recentOrders: {
    id: string;
    orderNumber: number;
    customerName: string | null;
    totalMinor: number;
    status: string;
    createdAt: string;
  }[];
  recentConversations: { id: string; channel: string; status: string; lastMessageAt: string | null }[];
  topProducts: { name: string; quantity: number; revenueMinor: number }[];
};

/**
 * Real, tenant-scoped dashboard data (spec: "every visible element must
 * use real application data or an honest empty state") — no fabricated
 * numbers. `conversion rate` and `customers by source` from the reference
 * design are deliberately not computed here: this schema has no visit/
 * session funnel and no acquisition-channel attribution to back them.
 *
 * The aggregates come from `tenant_dashboard_stats` (Postgres, SECURITY
 * INVOKER — the same RLS as a direct select) instead of downloading every
 * order and order item the tenant ever had; only the five newest orders
 * and conversations are fetched as rows. Trend, AOV and status-group math
 * below is unchanged from the previous in-JS implementation.
 */
export async function getTenantDashboardStats(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
): Promise<DashboardStats> {
  const [
    { data: aggregates, error },
    { data: recentOrdersRaw },
    { count: conversationsCount },
    { count: productsCount },
    { data: recentConversationsRaw },
  ] = await timed(
    "dashboard.queries",
    Promise.all([
      supabase.rpc("tenant_dashboard_stats", { p_tenant_id: tenantId, p_locale: locale, p_window_days: WINDOW_DAYS }),
      supabase
        .from("orders")
        .select("id, order_number, customer_name, total_minor, status, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(5),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase
        .from("conversations")
        .select("id, channel, status, last_message_at")
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(5),
    ]),
  );
  if (error) throw new Error(`Failed to load dashboard stats: ${error.message}`);

  const totalSalesMinor = Number(aggregates?.total_sales_minor ?? 0);
  const ordersCount = Number(aggregates?.orders_count ?? 0);
  const avgOrderValueMinor = ordersCount > 0 ? Math.round(totalSalesMinor / ordersCount) : 0;
  const customersCount = Number(aggregates?.customers_count ?? 0);

  const trend = (current: number, prior: number): Trend => {
    if (prior === 0) return null; // no baseline to compare against — an honest "new" rather than a fabricated percentage
    const pct = Math.round(((current - prior) / prior) * 1000) / 10;
    return { pct: Math.abs(pct), direction: pct >= 0 ? "up" : "down" };
  };
  const currentSales = Number(aggregates?.current_sales_minor ?? 0);
  const priorSales = Number(aggregates?.prior_sales_minor ?? 0);
  const currentOrders = Number(aggregates?.current_orders ?? 0);
  const priorOrders = Number(aggregates?.prior_orders ?? 0);
  const currentAov = currentOrders > 0 ? currentSales / currentOrders : 0;
  const priorAov = priorOrders > 0 ? priorSales / priorOrders : 0;
  const trends = {
    sales: trend(currentSales, priorSales),
    orders: trend(currentOrders, priorOrders),
    customers: trend(Number(aggregates?.current_customers ?? 0), Number(aggregates?.prior_customers ?? 0)),
    avgOrderValue: trend(currentAov, priorAov),
  };

  const days: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const salesByDay = aggregates?.sales_by_day ?? {};
  const salesSeries = days.map((date) => ({ date, totalMinor: Number(salesByDay[date] ?? 0) }));

  const groupCounts: Record<string, number> = { pending: 0, active: 0, completed: 0, cancelled: 0 };
  for (const [status, count] of Object.entries(aggregates?.status_counts ?? {})) {
    const group = orderStatusGroup(status);
    groupCounts[group] = (groupCounts[group] ?? 0) + Number(count);
  }
  const ordersByStatusGroup = (["pending", "active", "completed", "cancelled"] as const).map((group) => ({
    label: group.charAt(0).toUpperCase() + group.slice(1),
    count: groupCounts[group],
    color: ORDER_STATUS_GROUP_COLOR[group],
  }));

  const recentOrders = (recentOrdersRaw ?? []).map((order) => ({
    id: order.id,
    orderNumber: order.order_number,
    customerName: order.customer_name,
    totalMinor: order.total_minor,
    status: order.status,
    createdAt: order.created_at,
  }));

  const recentConversations = (recentConversationsRaw ?? []).map((c) => ({
    id: c.id,
    channel: c.channel,
    status: c.status,
    lastMessageAt: c.last_message_at,
  }));

  const topProducts = (aggregates?.top_products ?? []).map((p) => ({
    name: p.name,
    quantity: Number(p.quantity),
    revenueMinor: Number(p.revenue_minor),
  }));

  return {
    totalSalesMinor,
    ordersCount,
    customersCount,
    avgOrderValueMinor,
    trends,
    conversationsCount: conversationsCount ?? 0,
    productsCount: productsCount ?? 0,
    salesSeries,
    ordersByStatusGroup,
    recentOrders,
    recentConversations,
    topProducts,
  };
}
