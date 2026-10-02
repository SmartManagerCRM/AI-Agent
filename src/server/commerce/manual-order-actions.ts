"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { buildBulkOrders, type ManualOrderInput } from "@/lib/orders/bulk-orders";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import type { Json } from "@/types/database";

/**
 * Staff add orders by hand — one at a time, or many from a CSV. Both go
 * through `create_manual_orders`, which checks `orders.write`, re-reads
 * every price from the catalog and computes delivery fee and tax exactly
 * like checkout; a batch is all-or-nothing.
 */

export type ManualOrderState = { ok: boolean; message: string; errors?: string[] } | undefined;

/** "VALIDATION_ERROR: …" from the database → the sentence after the prefix. */
function dbMessage(message: string | undefined): string {
  const m = /^(VALIDATION_ERROR|NOT_FOUND|PERMISSION_ERROR): (.+)$/.exec(message ?? "");
  if (m?.[1] === "PERMISSION_ERROR") return "You don't have permission to add orders for this business.";
  return m ? m[2].charAt(0).toUpperCase() + m[2].slice(1) + "." : "Couldn't add the order — please try again.";
}

const text = (max: number) => z.string().trim().max(max).optional().default("");

const singleSchema = z.object({
  locale: z.string(),
  slug: z.string().min(1),
  items: z
    .array(z.object({ product_id: z.uuid(), quantity: z.coerce.number().int().min(1).max(999) }))
    .min(1, "Add at least one product.")
    .max(100),
  fulfillment_type: z.enum(["pickup", "delivery", "dine_in"]),
  customer_name: text(120),
  customer_phone: text(40),
  delivery_address: text(500),
  notes: text(1000),
  paid: z.boolean(),
});

export async function createManualOrderAction(_prev: ManualOrderState, formData: FormData): Promise<ManualOrderState> {
  let items: unknown = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: "Add at least one product." };
  }
  const parsed = singleSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    items,
    fulfillment_type: formData.get("fulfillment_type"),
    customer_name: formData.get("customer_name") ?? "",
    customer_phone: formData.get("customer_phone") ?? "",
    delivery_address: formData.get("delivery_address") ?? "",
    notes: formData.get("notes") ?? "",
    paid: formData.get("paid") === "on",
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the order details." };
  const d = parsed.data;
  const { tenant } = await requireTenantMember(d.locale, d.slug);
  const supabase = await createUserClient();

  const order: Omit<ManualOrderInput, "ref"> = {
    items: d.items,
    fulfillment_type: d.fulfillment_type,
    customer_name: d.customer_name || null,
    customer_phone: d.customer_phone || null,
    delivery_address: d.fulfillment_type === "delivery" ? d.delivery_address || null : null,
    notes: d.notes || null,
    paid: d.paid,
  };
  const { data, error } = await supabase.rpc("create_manual_orders", {
    p_tenant_id: tenant.id,
    p_orders: [order] as unknown as Json,
    p_created_via: "manual",
  });
  if (error || !data?.[0]) return { ok: false, message: dbMessage(error?.message) };
  revalidatePath(`/${d.locale}/${d.slug}/orders`);
  revalidatePath(`/${d.locale}/${d.slug}`);
  return { ok: true, message: `Order #${data[0].order_number} added.` };
}

const MAX_CSV_BYTES = 1024 * 1024;

export async function bulkCreateOrdersAction(_prev: ManualOrderState, formData: FormData): Promise<ManualOrderState> {
  const locale = String(formData.get("locale") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const file = formData.get("file");
  let csv = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES)
      return { ok: false, message: "The file is too large — keep it under 1 MB (about 2,000 rows)." };
    csv = await file.text();
  }
  if (!csv.trim()) return { ok: false, message: "Choose a CSV file or paste the rows first." };

  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const { data: products } = await supabase
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenant.id)
    .neq("status", "archived")
    .is("source_price", null); // still waiting for the owner's price
  const catalog = (products ?? []).map((p) => ({ id: p.id, names: Object.values(p.name ?? {}).map(String) }));

  const { orders, errors } = buildBulkOrders(csv, catalog);
  if (errors.length > 0) {
    return { ok: false, message: "Nothing was added — fix these rows and upload again:", errors };
  }
  const { data, error } = await supabase.rpc("create_manual_orders", {
    p_tenant_id: tenant.id,
    p_orders: orders as unknown as Json,
    p_created_via: "bulk_import",
  });
  if (error || !data?.length) return { ok: false, message: `Nothing was added — ${dbMessage(error?.message)}` };
  revalidatePath(`/${locale}/${slug}/orders`);
  revalidatePath(`/${locale}/${slug}`);
  const numbers = data.map((o) => o.order_number).sort((a, b) => a - b);
  return {
    ok: true,
    message:
      numbers.length === 1
        ? `1 order added (#${numbers[0]}).`
        : `${numbers.length} orders added (#${numbers[0]}–#${numbers[numbers.length - 1]}).`,
  };
}
