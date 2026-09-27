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
