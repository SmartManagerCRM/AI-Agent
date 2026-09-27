"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const schema = z.object({
  orderId: z.uuid(),
  newStatus: z.enum(["pending_payment", "paid", "confirmed", "preparing", "ready", "completed", "cancelled", "refunded"]),
  slug: z.string().min(1),
  locale: z.string(),
});

/** Staff-driven order status transitions (spec §16) — `update_order_status` itself enforces the allowed transition table. */
export async function updateOrderStatusAction(formData: FormData): Promise<void> {
  const parsed = schema.safeParse({
    orderId: formData.get("orderId"),
    newStatus: formData.get("newStatus"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("update_order_status", { p_order_id: parsed.data.orderId, p_new_status: parsed.data.newStatus });
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/orders`);
}

const cashSchema = z.object({ paymentId: z.uuid(), slug: z.string().min(1), locale: z.string() });

/**
 * Staff confirms real cash (or a paid table bill) was actually collected
 * for a Cash on Delivery / Pay on Table order (`mark_cash_payment_collected`,
 * SQL) — the order itself was already `confirmed` at creation time (spec:
 * "the order should be confirmed... the customer will pay later"); this
 * only updates the `payments` row so the console stops showing it as
 * awaiting collection.
 */
export async function markCashPaymentCollectedAction(formData: FormData): Promise<void> {
  const parsed = cashSchema.safeParse({
    paymentId: formData.get("paymentId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("mark_cash_payment_collected", { p_payment_id: parsed.data.paymentId });
  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/orders`);
}
