"use server";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
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

type T = Awaited<ReturnType<typeof actionT>>;

/** `create_manual_orders`' messages (English, from the database) → actions.orders.db.* in the user's language. */
const DB_REASONS: [RegExp, string][] = [
  [/^a product is not in your catalog$/, "db.notInCatalog"],
  [/^a product still needs its price$/, "db.needsPrice"],
  [/^quantities must be whole numbers from 1 to 999$/, "db.quantities"],
  [/^a customer detail is too long$/, "db.tooLong"],
  [/^a delivery order needs a delivery address$/, "db.address"],
  [/^add at least one product$/, "db.addProduct"],
  [/^an order can have at most 100 lines$/, "db.maxLines"],
  [/^fulfillment must be pickup, delivery or dine-in$/, "db.fulfillment"],
  [/^add at most 200 orders at a time$/, "db.max200"],
  [/^there are no orders to add$/, "db.none"],
];

/** "VALIDATION_ERROR: …" from the database → that sentence, in the user's language. */
function dbMessage(t: T, message: string | undefined): string {
  const m = /^(VALIDATION_ERROR|NOT_FOUND|PERMISSION_ERROR): (.+)$/.exec(message ?? "");
  if (m?.[1] === "PERMISSION_ERROR") return t("orders.noPermission");
  if (!m || m[1] !== "VALIDATION_ERROR") return t("orders.addFailed");
  const labelled = /^order (.+?): (.+)$/.exec(m[2]);
  const label = labelled ? t("orders.db.label", { ref: labelled[1] }) : "";
  const reason = labelled ? labelled[2] : m[2];
  const key = DB_REASONS.find(([re]) => re.test(reason))?.[1];
  if (!key) return t("orders.addFailed");
  const text = t(`orders.${key}`, { label });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The CSV checker's row problems (English, src/lib/orders/bulk-orders.ts) → actions.orders.row.*. */
function rowError(t: T, error: string): string {
  const rules: [RegExp, (m: RegExpExecArray) => string][] = [
    [/^The file has no order rows/, () => t("orders.row.noRows")],
    [/^The header row needs at least "product" and "quantity" columns \((.+)\)\.$/, (m) => t("orders.row.header", { columns: m[1] })],
    [/^At most (\d+) rows at a time\.$/, (m) => t("orders.row.maxRows", { n: m[1] })],
    [/^Row (\d+): the product is missing\.$/, (m) => t("orders.row.noProduct", { row: m[1] })],
    [/^Row (\d+): "(.*)" isn't in your catalog\.$/, (m) => t("orders.row.unknownProduct", { row: m[1], product: m[2] })],
    [/^Row (\d+): the quantity must be/, (m) => t("orders.row.quantity", { row: m[1] })],
    [/^Row (\d+): fulfillment must be/, (m) => t("orders.row.fulfillment", { row: m[1] })],
    [/^Order (.+): at most 100 lines per order\.$/, (m) => t("orders.row.maxLines", { ref: m[1] })],
    [/^Order (.+): a delivery order needs a delivery_address\.$/, (m) => t("orders.row.address", { ref: m[1] })],
    [/^At most (\d+) orders at a time \(this file has (\d+)\)\.$/, (m) => t("orders.row.maxOrders", { n: m[1], count: m[2] })],
  ];
  for (const [re, word] of rules) {
    const m = re.exec(error);
    if (m) return word(m);
  }
  return error;
}

const text = (max: number) => z.string().trim().max(max).optional().default("");

const singleSchema = z.object({
  locale: z.string(),
  slug: z.string().min(1),
  items: z
    .array(z.object({ product_id: z.uuid(), quantity: z.coerce.number().int().min(1).max(999) }))
    .min(1, "@orders.addProduct")
    .max(100),
  fulfillment_type: z.enum(["pickup", "delivery", "dine_in"]),
  customer_name: text(120),
  customer_phone: text(40),
  delivery_address: text(500),
  notes: text(1000),
  paid: z.boolean(),
});

export async function createManualOrderAction(_prev: ManualOrderState, formData: FormData): Promise<ManualOrderState> {
  const t = await actionT(formData.get("locale"));
  let items: unknown = [];
  try {
    items = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { ok: false, message: t("orders.addProduct") };
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
  if (!parsed.success) return { ok: false, message: issueMessage(t, parsed.error.issues, "orders.checkDetails") };
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
  if (error || !data?.[0]) return { ok: false, message: dbMessage(t, error?.message) };
  revalidatePath(`/${d.locale}/${d.slug}/orders`);
  revalidatePath(`/${d.locale}/${d.slug}`);
  return { ok: true, message: t("orders.added", { n: data[0].order_number }) };
}

const MAX_CSV_BYTES = 1024 * 1024;

export async function bulkCreateOrdersAction(_prev: ManualOrderState, formData: FormData): Promise<ManualOrderState> {
  const locale = String(formData.get("locale") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const t = await actionT(locale);
  const file = formData.get("file");
  let csv = String(formData.get("csv") ?? "");
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_CSV_BYTES)
      return { ok: false, message: t("orders.csvTooLarge") };
    csv = await file.text();
  }
  if (!csv.trim()) return { ok: false, message: t("orders.csvEmpty") };

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
    return { ok: false, message: t("orders.fixRows"), errors: errors.map((e) => rowError(t, e)) };
  }
  const { data, error } = await supabase.rpc("create_manual_orders", {
    p_tenant_id: tenant.id,
    p_orders: orders as unknown as Json,
    p_created_via: "bulk_import",
  });
  if (error || !data?.length) return { ok: false, message: t("orders.nothingAdded", { reason: dbMessage(t, error?.message) }) };
  revalidatePath(`/${locale}/${slug}/orders`);
  revalidatePath(`/${locale}/${slug}`);
  const numbers = data.map((o) => o.order_number).sort((a, b) => a - b);
  return {
    ok: true,
    message:
      numbers.length === 1
        ? t("orders.bulkOne", { n: numbers[0] })
        : t("orders.bulkMany", { count: numbers.length, first: numbers[0], last: numbers[numbers.length - 1] }),
  };
}
