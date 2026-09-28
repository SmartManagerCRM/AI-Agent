import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

const STATUS_GROUPS: Record<string, "pending" | "active" | "completed" | "cancelled"> = {
  draft: "pending",
  pending_payment: "pending",
  paid: "active",
  confirmed: "active",
  preparing: "active",
  ready: "active",
  completed: "completed",
  cancelled: "cancelled",
  refunded: "cancelled",
};

const STATUS_GROUP_COLOR: Record<string, string> = {
  pending: "#f59e0b",
  active: "#3b82f6",
  completed: "#10b981",
  cancelled: "#ef4444",
};

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
 */
export async function getTenantDashboardStats(supabase: TypedSupabaseClient, tenantId: string, locale: string): Promise<DashboardStats> {
  const [{ data: orders }, { count: conversationsCount }, { count: productsCount }, { data: recentConversationsRaw }, { data: orderItems }] =
    await Promise.all([
      supabase
        .from("orders")
        .select("id, order_number, customer_name, customer_email, customer_phone, total_minor, status, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false }),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase.from("products").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
      supabase
        .from("conversations")
        .select("id, channel, status, last_message_at")
        .eq("tenant_id", tenantId)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(5),
      supabase
        .from("order_items")
        .select("product_name, quantity, total_minor, order_id")
        .eq("tenant_id", tenantId),
    ]);

  const allOrders = orders ?? [];
  const totalSalesMinor = allOrders.reduce((sum, o) => sum + o.total_minor, 0);
  const ordersCount = allOrders.length;
  const avgOrderValueMinor = ordersCount > 0 ? Math.round(totalSalesMinor / ordersCount) : 0;
  const customersCount = new Set(allOrders.map((o) => o.customer_email ?? o.customer_phone ?? o.customer_name).filter(Boolean)).size;

  const now = Date.now();
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const currentWindowOrders = allOrders.filter((o) => new Date(o.created_at).getTime() >= now - windowMs);
  const priorWindowOrders = allOrders.filter((o) => {
    const t = new Date(o.created_at).getTime();
    return t >= now - 2 * windowMs && t < now - windowMs;
  });
  const trend = (current: number, prior: number): Trend => {
    if (prior === 0) return null; // no baseline to compare against — an honest "new" rather than a fabricated percentage
    const pct = Math.round(((current - prior) / prior) * 1000) / 10;
    return { pct: Math.abs(pct), direction: pct >= 0 ? "up" : "down" };
  };
  const currentSales = currentWindowOrders.reduce((sum, o) => sum + o.total_minor, 0);
  const priorSales = priorWindowOrders.reduce((sum, o) => sum + o.total_minor, 0);
  const currentCustomers = new Set(currentWindowOrders.map((o) => o.customer_email ?? o.customer_phone ?? o.customer_name).filter(Boolean)).size;
  const priorCustomers = new Set(priorWindowOrders.map((o) => o.customer_email ?? o.customer_phone ?? o.customer_name).filter(Boolean)).size;
  const currentAov = currentWindowOrders.length > 0 ? currentSales / currentWindowOrders.length : 0;
  const priorAov = priorWindowOrders.length > 0 ? priorSales / priorWindowOrders.length : 0;
  const trends = {
    sales: trend(currentSales, priorSales),
    orders: trend(currentWindowOrders.length, priorWindowOrders.length),
    customers: trend(currentCustomers, priorCustomers),
    avgOrderValue: trend(currentAov, priorAov),
  };

  const days: string[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    days.push(new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  const salesByDay = new Map(days.map((day) => [day, 0]));
  for (const order of allOrders) {
    const day = order.created_at.slice(0, 10);
    if (salesByDay.has(day)) salesByDay.set(day, (salesByDay.get(day) ?? 0) + order.total_minor);
  }
  const salesSeries = Array.from(salesByDay, ([date, totalMinor]) => ({ date, totalMinor }));

  const groupCounts: Record<string, number> = { pending: 0, active: 0, completed: 0, cancelled: 0 };
  for (const order of allOrders) {
    const group = STATUS_GROUPS[order.status] ?? "pending";
    groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  }
  const ordersByStatusGroup = (["pending", "active", "completed", "cancelled"] as const).map((group) => ({
    label: group.charAt(0).toUpperCase() + group.slice(1),
    count: groupCounts[group],
    color: STATUS_GROUP_COLOR[group],
  }));

  const recentOrders = allOrders.slice(0, 5).map((order) => ({
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
    .slice(0, 5);

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
