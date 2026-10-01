import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Cart service (spec §13's cart tools). Every function takes the tenant id
 * explicitly and filters by it even though the caller (today: the
 * service-role client from `src/server/agent-public/actions.ts`) already
 * bypasses RLS — there is no RLS backstop on this path, so tenant scoping
 * has to be correct here, not assumed from context.
 *
 * No `import "server-only"` here — `matchProductByName` is imported
 * directly by its own unit tests, same reasoning as `src/server/ai/
 * gemini.ts`, and `TypedSupabaseClient` is a type-only import (erased at
 * compile time) so nothing here actually depends on the guarded client
 * module at runtime.
 */
export type PaymentMethod = "moyasar" | "tap" | "cash_on_delivery" | "pay_on_table";

export type CartRow = {
  id: string;
  status: "active" | "converted" | "abandoned";
  fulfillmentType: "pickup" | "delivery" | "dine_in" | null;
  paymentMethod: PaymentMethod | null;
  branchId: string | null;
  tableId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  deliveryAddress: unknown;
  notes: string | null;
  couponCode: string | null;
};

export type CartItemView = {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  totalMinor: number;
};

export type CouponPreview = { valid: boolean; message: string | null; discountMinor: number };

export type CartView = {
  cart: CartRow;
  items: CartItemView[];
  subtotalMinor: number;
  coupon: CouponPreview | null;
};

/**
 * The conversation's ACTIVE cart, or a new one. A cart that became an order
 * (`converted`) is never reused — after each order the customer gets a fresh
 * cart, pre-filled with the details they already gave (contact, fulfillment,
 * payment choice, table) so they don't have to enter them again.
 */
export async function getOrCreateCart(
  supabase: TypedSupabaseClient,
  tenantId: string,
  conversationId: string,
): Promise<CartRow> {
  const findActive = () =>
    supabase
      .from("carts")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("conversation_id", conversationId)
      .eq("status", "active")
      .maybeSingle();

  const { data: existing } = await findActive();
  if (existing) return toCartRow(existing);

  const { data: previous } = await supabase
    .from("carts")
    .select("customer_name, customer_phone, customer_email, delivery_address, fulfillment_type, payment_method, branch_id, table_id")
    .eq("tenant_id", tenantId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("carts")
    .insert({ tenant_id: tenantId, conversation_id: conversationId, ...(previous ?? {}) })
    .select("*")
    .single();
  if (error?.code === "23505") {
    // A parallel request created the active cart first (one active cart per conversation) — use that one.
    const { data: raced } = await findActive();
    if (raced) return toCartRow(raced);
  }
  if (error || !data) throw new Error(`Failed to create cart: ${error?.message ?? "unknown error"}`);
  return toCartRow(data);
}

function toCartRow(row: {
  id: string;
  status: "active" | "converted" | "abandoned";
  fulfillment_type: "pickup" | "delivery" | "dine_in" | null;
  payment_method: PaymentMethod | null;
  branch_id: string | null;
  table_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  delivery_address: unknown;
  notes: string | null;
  coupon_code: string | null;
}): CartRow {
  return {
    id: row.id,
    status: row.status,
    fulfillmentType: row.fulfillment_type,
    paymentMethod: row.payment_method,
    branchId: row.branch_id,
    tableId: row.table_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email,
    deliveryAddress: row.delivery_address,
    notes: row.notes,
    couponCode: row.coupon_code,
  };
}

export type NamedProduct = { id: string; name: string; priceMinor: number };

/**
 * Pure best-effort name matcher — no I/O, unit-tested directly. Exact
 * (case-insensitive) match wins outright; otherwise the first product whose
 * name contains the query, or vice versa (so "latte" matches "Spanish
 * Latte" and "spanish latte please" still matches "Spanish Latte").
 */
export function matchProductByName(
  products: { id: string; name: Record<string, string>; price_minor: number }[],
  locale: string,
  query: string,
): NamedProduct | null {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return null;

  let best: NamedProduct | null = null;
  for (const product of products) {
    const localizedName = (product.name[locale] ?? Object.values(product.name)[0] ?? "").toLowerCase();
    if (!localizedName) continue;
    if (localizedName === normalizedQuery)
      return { id: product.id, name: localizedName, priceMinor: product.price_minor };
    if (!best && (localizedName.includes(normalizedQuery) || normalizedQuery.includes(localizedName))) {
      best = { id: product.id, name: localizedName, priceMinor: product.price_minor };
    }
  }
  return best;
}

/** Finds an active product by name (best-effort, case-insensitive) — see `src/server/ai/tools/handlers.ts` for why name, not id. */
export async function findActiveProductByName(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  query: string,
): Promise<NamedProduct | null> {
  const { data } = await supabase
    .from("products")
    .select("id, name, price_minor")
    .eq("tenant_id", tenantId)
    .eq("status", "active");
  return matchProductByName(data ?? [], locale, query);
}

export async function viewCart(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  locale: string,
): Promise<CartView> {
  const { data: cartRow, error: cartError } = await supabase
    .from("carts")
    .select("*")
    .eq("id", cartId)
    .eq("tenant_id", tenantId)
    .single();
  if (cartError || !cartRow) throw new Error("Cart not found.");

  const { data: items } = await supabase
    .from("cart_items")
    .select("product_id, quantity")
    .eq("cart_id", cartId)
    .eq("tenant_id", tenantId);
  const productIds = (items ?? []).map((i) => i.product_id);
  const { data: products } = productIds.length
    ? await supabase.from("products").select("id, name, price_minor").eq("tenant_id", tenantId).in("id", productIds)
    : { data: [] };
  const productsById = new Map((products ?? []).map((p) => [p.id, p]));

  let subtotalMinor = 0;
  const itemViews: CartItemView[] = [];
  for (const item of items ?? []) {
    const product = productsById.get(item.product_id);
    if (!product) continue;
    const totalMinor = product.price_minor * item.quantity;
    subtotalMinor += totalMinor;
    itemViews.push({
      productId: product.id,
      name: product.name[locale] ?? Object.values(product.name)[0] ?? "",
      quantity: item.quantity,
      unitPriceMinor: product.price_minor,
      totalMinor,
    });
  }

  let coupon: CouponPreview | null = null;
  if (cartRow.coupon_code) {
    const { data } = await supabase.rpc("validate_coupon", {
      p_tenant_id: tenantId,
      p_code: cartRow.coupon_code,
      p_subtotal_minor: subtotalMinor,
    });
    const result = data?.[0];
    if (result) coupon = { valid: result.valid, message: result.message, discountMinor: result.discount_minor };
  }

  return { cart: toCartRow(cartRow), items: itemViews, subtotalMinor, coupon };
}

export async function addToCart(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  const { data: existing } = await supabase
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartId)
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("cart_items")
      .update({ quantity: existing.quantity + quantity })
      .eq("id", existing.id);
  } else {
    await supabase.from("cart_items").insert({ tenant_id: tenantId, cart_id: cartId, product_id: productId, quantity });
  }
}

export async function setCartItemQuantity(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  productId: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    await supabase
      .from("cart_items")
      .delete()
      .eq("cart_id", cartId)
      .eq("tenant_id", tenantId)
      .eq("product_id", productId);
    return;
  }
  const { data: existing } = await supabase
    .from("cart_items")
    .select("id")
    .eq("cart_id", cartId)
    .eq("tenant_id", tenantId)
    .eq("product_id", productId)
    .maybeSingle();
  if (existing) {
    await supabase.from("cart_items").update({ quantity }).eq("id", existing.id);
  } else {
    await supabase.from("cart_items").insert({ tenant_id: tenantId, cart_id: cartId, product_id: productId, quantity });
  }
}

export async function removeFromCart(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  productId: string,
): Promise<void> {
  await supabase
    .from("cart_items")
    .delete()
    .eq("cart_id", cartId)
    .eq("tenant_id", tenantId)
    .eq("product_id", productId);
}

export async function clearCart(supabase: TypedSupabaseClient, tenantId: string, cartId: string): Promise<void> {
  await supabase.from("cart_items").delete().eq("cart_id", cartId).eq("tenant_id", tenantId);
}

export async function setFulfillment(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  fulfillmentType: "pickup" | "delivery" | "dine_in",
  branchId: string | null,
  tableId: string | null,
): Promise<void> {
  await supabase
    .from("carts")
    .update({ fulfillment_type: fulfillmentType, branch_id: branchId, table_id: tableId })
    .eq("id", cartId)
    .eq("tenant_id", tenantId);
}

export async function setPaymentMethod(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  paymentMethod: PaymentMethod,
): Promise<void> {
  await supabase.from("carts").update({ payment_method: paymentMethod }).eq("id", cartId).eq("tenant_id", tenantId);
}

/** Stores the code as entered — never validated here. `create_order_from_cart` is the only place a coupon is ever actually applied. */
export async function setCouponCode(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  couponCode: string | null,
): Promise<void> {
  await supabase.from("carts").update({ coupon_code: couponCode }).eq("id", cartId).eq("tenant_id", tenantId);
}

export async function setCustomerDetails(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  details: { name?: string; phone?: string; email?: string; deliveryAddress?: string },
): Promise<void> {
  const patch: {
    customer_name?: string;
    customer_phone?: string;
    customer_email?: string;
    delivery_address?: { formatted: string };
  } = {};
  if (details.name) patch.customer_name = details.name;
  if (details.phone) patch.customer_phone = details.phone;
  if (details.email) patch.customer_email = details.email;
  if (details.deliveryAddress) patch.delivery_address = { formatted: details.deliveryAddress };
  if (Object.keys(patch).length === 0) return;
  await supabase.from("carts").update(patch).eq("id", cartId).eq("tenant_id", tenantId);
}

export async function setOrderNotes(
  supabase: TypedSupabaseClient,
  tenantId: string,
  cartId: string,
  notes: string,
): Promise<void> {
  await supabase.from("carts").update({ notes }).eq("id", cartId).eq("tenant_id", tenantId);
}
