import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { ManualOrders } from "@/components/commerce/manual-orders";
import { OrderControls } from "@/components/commerce/order-controls";
import { NewOrderBadge } from "@/components/notifications/notification-center";
import { SearchInput } from "@/components/console/search-input";
import { StatusPill } from "@/components/console/status-pill";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_GROUPS } from "@/lib/order-status";
import { markCashPaymentCollectedAction, updateOrderStatusAction } from "@/server/commerce/order-actions";
import { timed } from "@/server/perf";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import type { Database } from "@/types/database";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";
import { fulfillmentLabel, statusLabel } from "@/lib/i18n-labels";

const CASH_METHODS = new Set(["cash_on_delivery", "pay_on_table"]);

const NEXT_STATUSES: Record<string, string[]> = {
  draft: ["pending_payment", "cancelled"],
  pending_payment: ["paid", "cancelled"],
  paid: ["confirmed", "refunded"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  refunded: [],
};

const GROUPS = ["all", "pending", "active", "completed", "cancelled"] as const;
type Group = (typeof GROUPS)[number];
const PAGE_SIZE = 50;

type OrderStatus = Database["public"]["Tables"]["orders"]["Row"]["status"];

/** The raw statuses behind each status tab. */
const statusesIn = (group: Exclude<Group, "all">) =>
  Object.entries(ORDER_STATUS_GROUPS)
    .filter(([, g]) => g === group)
    .map(([status]) => status as OrderStatus);

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  const { locale, slug } = await params;
  const { status: statusParam, q, page: pageParam } = await searchParams;
  const statusFilter: Group = GROUPS.find((g) => g === statusParam) ?? "all";
  const page = parsePage(pageParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.orders");
  const tAll = await getTranslations();

  // Counts are exact (counted in Postgres), and the list is paged — every order is reachable, however many there are.
  const countOf = (group: Group) => {
    let count = supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
    if (group !== "all") count = count.in("status", statusesIn(group));
    if (q) count = count.ilike("customer_name", `%${q}%`);
    return count.then(({ count: n }) => n ?? 0);
  };
  let query = supabase
    .from("orders")
    .select("id, order_number, status, fulfillment_type, customer_name, customer_phone, customer_email, delivery_address, notes, total_minor, currency, placed_at, created_via")
    .eq("tenant_id", tenant.id)
    .order("placed_at", { ascending: false })
    .order("id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (statusFilter !== "all") query = query.in("status", statusesIn(statusFilter));
  if (q) query = query.ilike("customer_name", `%${q}%`);
  const [{ data: ordersRaw }, { data: currency }, { data: catalog }, groupCounts] = await timed(
    "orders.queries",
    Promise.all([
      query,
      supabase.from("currencies").select("code, exponent"),
      supabase
        .from("products")
        .select("id, name, price_minor, status")
        .eq("tenant_id", tenant.id)
        .neq("status", "archived")
        .is("source_price", null) // still waiting for the owner's price
        .order("created_at", { ascending: false })
        .limit(1000),
      Promise.all(GROUPS.map(countOf)),
    ]),
  );
  const orders = ordersRaw ?? [];
  const exponents = new Map((currency ?? []).map((c) => [c.code, c.exponent]));
  const exponent = exponents.get(tenant.currency) ?? 2;
  // Each order in the currency it was placed in (it keeps it if the business later switches).
  const money = (minor: number, code: string = tenant.currency) => formatMoney(minor, code, exponents.get(code) ?? 2, locale);

  const orderIds = orders.map((o) => o.id);
  const { data: payments } = await supabase
    .from("payments")
    .select("id, order_id, provider, status, created_at")
    .in("order_id", orderIds.length > 0 ? orderIds : [""])
    .order("created_at", { ascending: false });
  const latestPaymentByOrder = new Map<string, { id: string; provider: string; status: string }>();
  for (const p of payments ?? []) {
    if (!latestPaymentByOrder.has(p.order_id))
      latestPaymentByOrder.set(p.order_id, { id: p.id, provider: p.provider, status: p.status });
  }

  const counts = Object.fromEntries(GROUPS.map((group, i) => [group, groupCounts[i]])) as Record<Group, number>;

  const baseHref = `/${locale}/${slug}/orders`;
  const tabs: Tab[] = GROUPS.map((group) => ({
    key: group,
    label: tAll(`common.orderGroup.${group}`),
    count: counts[group],
    href: group === "all" ? baseHref : `${baseHref}?status=${group}`,
    active: statusFilter === group,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.orders.orders" /></h1>
        <SearchInput placeholder={t("searchPlaceholder")} defaultValue={q} />
      </div>
      <ManualOrders
        slug={slug}
        locale={locale}
        currency={tenant.currency}
        exponent={exponent}
        products={(catalog ?? [])
          .map((p) => ({
            id: p.id,
            name: p.name[locale] ?? Object.values(p.name)[0] ?? "",
            priceMinor: p.price_minor,
            draft: p.status === "draft",
          }))
          .sort((a, b) => Number(a.draft) - Number(b.draft) || a.name.localeCompare(b.name))}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="orders" accent="emerald" label={t("totalOrders")} value={String(counts.all)} trend={null} href={`/${locale}/${slug}/orders`} />
        <KpiTile icon="billing" accent="orange" label={tAll("common.orderGroup.pending")} value={String(counts.pending)} trend={null} href={`/${locale}/${slug}/orders?status=pending`} />
        <KpiTile icon="conversations" accent="blue" label={tAll("common.orderGroup.active")} value={String(counts.active)} trend={null} href={`/${locale}/${slug}/orders?status=active`} />
        <KpiTile icon="customers" accent="purple" label={tAll("common.orderGroup.completed")} value={String(counts.completed)} trend={null} href={`/${locale}/${slug}/orders?status=completed`} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="px-4 pt-3">
          <Tabs tabs={tabs} />
        </div>
        {orders.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-start font-medium">#</th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.customer" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.fulfillment" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.total" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.status" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.payment" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.orders.actions" /></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    id={`order-${order.id}`}
                    className="scroll-mt-24 border-b border-slate-100 transition-colors last:border-0 has-[[data-new-order]]:bg-emerald-50"
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      #{order.order_number}
                      <NewOrderBadge orderId={order.id} />
                      {order.created_via !== "agent" && (
                        <span className="ms-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                          {order.created_via === "manual" ? t("manual") : t("imported")}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{order.customer_name ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{fulfillmentLabel(tAll, order.fulfillment_type)}</td>
                    <td className="px-4 py-3 text-slate-700">{money(order.total_minor, order.currency)}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={order.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {statusLabel(tAll, latestPaymentByOrder.get(order.id)?.status)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(NEXT_STATUSES[order.status] ?? []).map((next) => (
                          <form key={next} action={updateOrderStatusAction}>
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="newStatus" value={next} />
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="locale" value={locale} />
                            <button
                              type="submit"
                              className="text-xs font-medium text-emerald-600 underline-offset-2 hover:underline"
                            >
                              {t("markAs", { status: statusLabel(tAll, next) })}
                            </button>
                          </form>
                        ))}
                        {(() => {
                          const payment = latestPaymentByOrder.get(order.id);
                          if (!payment || payment.status !== "pending" || !CASH_METHODS.has(payment.provider))
                            return null;
                          return (
                            <form action={markCashPaymentCollectedAction}>
                              <input type="hidden" name="paymentId" value={payment.id} />
                              <input type="hidden" name="slug" value={slug} />
                              <input type="hidden" name="locale" value={locale} />
                              <button
                                type="submit"
                                className="text-xs font-medium text-emerald-600 underline-offset-2 hover:underline"
                              >
                                <Msg id="console.orders.markCashCollected" />
                              </button>
                            </form>
                          );
                        })()}
                        <OrderControls
                          locale={locale}
                          slug={slug}
                          order={{
                            id: order.id,
                            number: order.order_number,
                            name: order.customer_name ?? "",
                            phone: order.customer_phone ?? "",
                            email: order.customer_email ?? "",
                            address: (order.delivery_address as { formatted?: string } | null)?.formatted ?? "",
                            notes: order.notes ?? "",
                            delivery: order.fulfillment_type === "delivery",
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title={counts.all === 0 && !q ? t("emptyTitle") : t("noMatchTitle")}
              description={
                counts.all === 0 && !q
                  ? t("emptyDescription")
                  : t("noMatchDescription")
              }
              actionLabel={counts.all === 0 && !q ? t("addProduct") : undefined}
              actionHref={counts.all === 0 && !q ? `/${locale}/${slug}/products` : undefined}
            />
          </div>
        )}
        <Pagination
          basePath={baseHref}
          params={{ status: statusFilter === "all" ? undefined : statusFilter, q }}
          page={page}
          pageSize={PAGE_SIZE}
          total={counts[statusFilter]}
        />
      </div>
    </div>
  );
}
