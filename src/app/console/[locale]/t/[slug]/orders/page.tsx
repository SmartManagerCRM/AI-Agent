import { updateOrderStatusAction } from "@/server/commerce/order-actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

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

export default async function OrdersPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: orders } = await supabase
    .from("orders")
    .select("id, order_number, status, fulfillment_type, customer_name, total_minor, currency, placed_at")
    .order("placed_at", { ascending: false })
    .limit(100);
  const { data: currency } = await supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle();
  const exponent = currency?.exponent ?? 2;

  const orderIds = (orders ?? []).map((o) => o.id);
  const { data: payments } = await supabase
    .from("payments")
    .select("order_id, provider, status, created_at")
    .in("order_id", orderIds.length > 0 ? orderIds : [""])
    .order("created_at", { ascending: false });
  // One row per order — the first (most recent) attempt, since `payments` is ordered newest-first above.
  const latestPaymentByOrder = new Map<string, { provider: string; status: string }>();
  for (const p of payments ?? []) {
    if (!latestPaymentByOrder.has(p.order_id)) latestPaymentByOrder.set(p.order_id, { provider: p.provider, status: p.status });
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">#</th>
            <th className="py-2 text-start">Customer</th>
            <th className="py-2 text-start">Fulfillment</th>
            <th className="py-2 text-start">Total</th>
            <th className="py-2 text-start">Status</th>
            <th className="py-2 text-start">Payment</th>
            <th className="py-2 text-start">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(orders ?? []).map((order) => (
            <tr key={order.id} className="border-b border-neutral-100">
              <td className="py-2">{order.order_number}</td>
              <td className="py-2">{order.customer_name ?? "—"}</td>
              <td className="py-2 capitalize">{order.fulfillment_type}</td>
              <td className="py-2">
                {(order.total_minor / 10 ** exponent).toFixed(exponent)} {order.currency}
              </td>
              <td className="py-2 capitalize">{order.status.replace("_", " ")}</td>
              <td className="py-2 capitalize text-neutral-500">
                {latestPaymentByOrder.get(order.id)?.status ?? "—"}
              </td>
              <td className="py-2">
                <div className="flex flex-wrap gap-2">
                  {(NEXT_STATUSES[order.status] ?? []).map((next) => (
                    <form key={next} action={updateOrderStatusAction}>
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="newStatus" value={next} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs text-blue-700 underline capitalize">
                        Mark {next.replace("_", " ")}
                      </button>
                    </form>
                  ))}
                </div>
              </td>
            </tr>
          ))}
          {(orders ?? []).length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-neutral-400">
                No orders yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
