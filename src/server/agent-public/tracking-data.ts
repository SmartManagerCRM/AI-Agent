import "server-only";

import { z } from "zod";

import type { Fulfillment } from "@/lib/order-tracking";
import { serviceClient } from "@/server/supabase/clients";

/**
 * An order's tracking page (`agent.<root>/track/<orderId>`): what the
 * customer who placed it sees while it's prepared, served, collected or
 * delivered. The order's id is the key — an unguessable link given only to
 * that customer (like the payment page's) — and only the order's progress
 * is returned: number, type, status, its steps' times, items, total, branch.
 */
export type OrderTracking = {
  orderId: string;
  tenantId: string;
  orderNumber: number;
  status: string;
  fulfillment: Fulfillment;
  placedAt: string;
  currency: string;
  currencyExponent: number;
  totalMinor: number;
  branchName: Record<string, string> | null;
  paymentStatus: string | null;
  paidAt: string | null;
  items: { name: Record<string, string>; quantity: number }[];
  history: { status: string; at: string }[];
};

function parse(raw: unknown): OrderTracking | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r.order_id !== "string") return null;
  return {
    orderId: r.order_id,
    tenantId: String(r.tenant_id),
    orderNumber: Number(r.order_number),
    status: String(r.status),
    fulfillment: (["pickup", "delivery", "dine_in"].includes(String(r.fulfillment_type)) ? r.fulfillment_type : "pickup") as Fulfillment,
    placedAt: String(r.placed_at),
    currency: String(r.currency).trim(),
    currencyExponent: typeof r.currency_exponent === "number" ? r.currency_exponent : 2,
    totalMinor: Number(r.total_minor),
    branchName: (r.branch_name as Record<string, string> | null) ?? null,
    paymentStatus: typeof r.payment_status === "string" ? r.payment_status : null,
    paidAt: typeof r.paid_at === "string" ? r.paid_at : null,
    items: Array.isArray(r.items) ? (r.items as OrderTracking["items"]) : [],
    history: Array.isArray(r.history) ? (r.history as OrderTracking["history"]) : [],
  };
}

/** The order's progress, for the page's first render (server only). */
export async function loadOrderTracking(orderId: string): Promise<OrderTracking | null> {
  if (!z.uuid().safeParse(orderId).success) return null;
  const { data } = await serviceClient().rpc("order_tracking", { p_order_id: orderId });
  return parse(data);
}
