import "server-only";

import { ORDER_STATUS_GROUP_COLOR, orderStatusGroup } from "@/lib/order-status";
import type { Trend } from "@/server/tenant/dashboard-stats";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRangeDays = (typeof ANALYTICS_RANGES)[number];

const PAYMENT_METHOD_COLOR: Record<string, string> = {
  moyasar: "#3b82f6",
  tap: "#8b5cf6",
  cash: "#10b981",
};

export type TenantAnalytics = {
  rangeDays: AnalyticsRangeDays;
  totalSalesMinor: number;
  ordersCount: number;
  avgOrderValueMinor: number;
  aiCostUsd: number;
  trends: { sales: Trend; orders: Trend; avgOrderValue: Trend; aiCost: Trend };
  salesSeries: { date: string; count: number }[];
  ordersByStatusGroup: { label: string; count: number; color: string }[];
  topProducts: { name: string; quantity: number; revenueMinor: number }[];
  paymentMethodBreakdown: { label: string; count: number; color: string }[];
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
  const now = Date.now();
  const windowMs = rangeDays * 24 * 60 * 60 * 1000;
  const sinceComparisonIso = new Date(now - 2 * windowMs).toISOString();

  const [{ data: orders }, { data: comparisonInteractions }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, total_minor, status, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", sinceComparisonIso),
    supabase
      .from("agent_interactions")
      .select("estimated_cost_usd, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", sinceComparisonIso),
  ]);

  const allOrders = orders ?? [];
  const currentOrders = allOrders.filter((o) => new Date(o.created_at).getTime() >= now - windowMs);
  const priorOrders = allOrders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= now - 2 * windowMs && t < now - windowMs;
  });

  const currentInteractions = (comparisonInteractions ?? []).filter((i) => new Date(i.created_at).getTime() >= now - windowMs);
  const priorInteractions = (comparisonInteractions ?? []).filter((i) => {
    const t = new Date(i.created_at).getTime();
    return t >= now - 2 * windowMs && t < now - windowMs;
  });

  const totalSalesMinor = currentOrders.reduce((sum, o) => sum + o.total_minor, 0);
  const ordersCount = currentOrders.length;
  const avgOrderValueMinor = ordersCount > 0 ? Math.round(totalSalesMinor / ordersCount) : 0;
  const aiCostUsd = currentInteractions.reduce((sum, i) => sum + i.estimated_cost_usd, 0);

  const priorSales = priorOrders.reduce((sum, o) => sum + o.total_minor, 0);
  const priorAov = priorOrders.length > 0 ? priorSales / priorOrders.length : 0;
  const priorAiCost = priorInteractions.reduce((sum, i) => sum + i.estimated_cost_usd, 0);

  const trends = {
    sales: trend(totalSalesMinor, priorSales),
    orders: trend(ordersCount, priorOrders.length),
    avgOrderValue: trend(avgOrderValueMinor, priorAov),
    aiCost: trend(aiCostUsd, priorAiCost),
  };

  const days: string[] = [];
  for (let i = rangeDays - 1; i >= 0; i--) {
    days.push(new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const salesByDay = new Map(days.map((day) => [day, 0]));
  for (const order of currentOrders) {
    const day = order.created_at.slice(0, 10);
    if (salesByDay.has(day)) salesByDay.set(day, (salesByDay.get(day) ?? 0) + order.total_minor);
  }
  const salesSeries = Array.from(salesByDay, ([date, count]) => ({ date, count }));

  const groupCounts: Record<string, number> = { pending: 0, active: 0, completed: 0, cancelled: 0 };
  for (const order of currentOrders) {
    const group = orderStatusGroup(order.status);
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  }
  const ordersByStatusGroup = (["pending", "active", "completed", "cancelled"] as const).map((group) => ({
    label: group.charAt(0).toUpperCase() + group.slice(1),
    count: groupCounts[group],
    color: ORDER_STATUS_GROUP_COLOR[group],
  }));

  const settledOrders = currentOrders.filter((o) => {
    const group = orderStatusGroup(o.status);
    return group === "active" || group === "completed";
  });
  const settledOrderIds = settledOrders.map((o) => o.id);

  const [{ data: orderItems }, { data: succeededPayments }] = await Promise.all([
    settledOrderIds.length
      ? supabase.from("order_items").select("product_name, quantity, total_minor, order_id").in("order_id", settledOrderIds)
      : Promise.resolve({ data: [] }),
    settledOrderIds.length
      ? supabase.from("payments").select("order_id, provider").eq("status", "succeeded").in("order_id", settledOrderIds)
      : Promise.resolve({ data: [] }),
  ]);

  const productTotals = new Map<string, { name: string; quantity: number; revenueMinor: number }>();
  for (const item of orderItems ?? []) {
    const name = (item.product_name as Record<string, string> | null)?.[locale] ?? (item.product_name as Record<string, string> | null)?.en ?? "—";
    const existing = productTotals.get(name) ?? { name, quantity: 0, revenueMinor: 0 };
    existing.quantity += item.quantity;
    existing.revenueMinor += item.total_minor;
    productTotals.set(name, existing);
  }
  const topProducts = Array.from(productTotals.values())
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, 10);

  const providerByOrder = new Map((succeededPayments ?? []).map((p) => [p.order_id, p.provider]));
  const methodCounts = new Map<string, number>();
  for (const order of settledOrders) {
    const provider = providerByOrder.get(order.id) ?? "cash";
    methodCounts.set(provider, (methodCounts.get(provider) ?? 0) + 1);
  }
  const paymentMethodBreakdown = Array.from(methodCounts, ([provider, count]) => ({
    label: provider === "cash" ? "Cash / in-person" : provider.charAt(0).toUpperCase() + provider.slice(1),
    count,
    color: PAYMENT_METHOD_COLOR[provider] ?? "#f59e0b",
  })).sort((a, b) => b.count - a.count);

  return {
    rangeDays,
    totalSalesMinor,
    ordersCount,
    avgOrderValueMinor,
    aiCostUsd,
    trends,
    salesSeries,
    ordersByStatusGroup,
    topProducts,
    paymentMethodBreakdown,
  };
}
