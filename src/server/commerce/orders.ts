import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type PlaceOrderResult =
  | { ok: true; orderId: string; orderNumber: number; totalMinor: number; currency: string }
  | { ok: false; error: string };

/**
 * The one path from cart to order (spec §15). `create_order_from_cart`
 * (SQL, SECURITY DEFINER) re-reads every price and recomputes the total —
 * this function only calls it and shapes the result; it never computes a
 * total itself.
 */
export async function placeOrder(supabase: TypedSupabaseClient, tenantId: string, cartId: string): Promise<PlaceOrderResult> {
  const { data: orderId, error } = await supabase.rpc("create_order_from_cart", { p_cart_id: cartId });
  if (error || !orderId) {
    return { ok: false, error: error?.message ?? "Could not place the order." };
  }

  const { data: order, error: fetchError } = await supabase
    .from("orders")
    .select("order_number, total_minor, currency")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .single();
  if (fetchError || !order) {
    return { ok: false, error: "Order was created but could not be read back." };
  }

  return { ok: true, orderId, orderNumber: order.order_number, totalMinor: order.total_minor, currency: order.currency };
}

export async function getOrderStatusByNumber(
  supabase: TypedSupabaseClient,
  tenantId: string,
  orderNumber: number,
): Promise<{ status: string; totalMinor: number; currency: string } | null> {
  const { data } = await supabase
    .from("orders")
    .select("status, total_minor, currency")
    .eq("tenant_id", tenantId)
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (!data) return null;
  return { status: data.status, totalMinor: data.total_minor, currency: data.currency };
}
