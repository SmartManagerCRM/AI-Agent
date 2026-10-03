"use server";

import { z } from "zod";

import { type AgentErrorCode, orderErrorCode } from "@/lib/agent-errors";
import { getOrCreateConversation } from "@/server/agent-public/conversation";
import { resolvePublicTenant, resolveWidgetTenant } from "@/server/agent-public/tenant";
import { isRateLimited } from "@/server/shared/rate-limit";
import {
  addToCart,
  getOrCreateCart,
  setCartItemQuantity,
  setCouponCode,
  setCustomerDetails,
  setFulfillment,
  setPaymentMethod,
  viewCart,
  type CartView,
  type PaymentMethod,
} from "@/server/commerce/cart";
import { placeOrder } from "@/server/commerce/orders";
import { findActiveTable } from "@/server/commerce/tables";
import { initiatePayment } from "@/server/payments/service";
import { serviceClient } from "@/server/supabase/clients";

/**
 * The External Agent's deterministic, structured-UI commerce actions — the
 * counterpart to `src/server/agent-public/actions.ts`'s free-text chat.
 *
 * Category navigation, product browsing, price display, cart operations
 * and checkout are all things a customer can do with certainty about what
 * they want — there is no ambiguity to resolve, no recommendation to make,
 * no natural language to understand. Every action here calls the exact
 * same commerce service functions the AI tool-calling loop uses
 * (`src/server/ai/tools/handlers.ts`) directly from a button click —
 * `runAgentGateway` is never invoked, so none of this costs an AI call or
 * counts against the deterministic-first metric's "ai" bucket at all; it
 * is simply never a gateway interaction in the first place. The free-text
 * chat panel remains the door to the LLM for whatever genuinely needs it
 * (recommendations, ambiguous requests, complaints, handoff) — both
 * surfaces share one cart via the same conversation cookie
 * (`getOrCreateConversation`).
 */

type ActionResult = { ok: true; cart: CartView } | { ok: false; error: AgentErrorCode };
type Surface = "external_agent" | "website_widget";

// Cheap DB writes, not an AI call — a much looser bound than the chat's
// own rate limit (spec §65) exists purely to stop a scripted client from
// hammering cart/checkout endpoints, not to ration a scarce resource.
const MUTATION_RATE_LIMIT_WINDOW_MS = 60_000;
const MUTATION_RATE_LIMIT_MAX = 60;

const DEFAULT_CHECKOUT = {
  ordering_enabled: false,
  fulfillment_types: ["pickup"] as ("pickup" | "delivery" | "dine_in")[],
  delivery_fee_minor: 0,
  minimum_order_minor: 0,
  tax_rate_bps: 0,
  tax_included: false,
};

async function loadContext(slug: string, surface: Surface = "external_agent") {
  const isWidget = surface === "website_widget";
  const tenant = await (isWidget ? resolveWidgetTenant(slug) : resolvePublicTenant(slug));
  if (!tenant) return null;
  const supabase = serviceClient();
  const conversation = await getOrCreateConversation(supabase, tenant.id, tenant.slug, tenant.defaultLanguage, {
    channel: surface,
    crossSite: isWidget,
  });
  const cart = await getOrCreateCart(supabase, tenant.id, conversation.id);
  const [{ data: settings }, { data: paymentConfig }] = await Promise.all([
    supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", tenant.id).maybeSingle(),
  ]);
  const checkout = settings?.checkout ?? DEFAULT_CHECKOUT;
  return {
    tenant,
    supabase,
    conversation,
    cart,
    orderingEnabled: checkout.ordering_enabled,
    fulfillmentTypes: checkout.fulfillment_types,
    paymentMethods: (paymentConfig?.enabled_methods ?? []) as PaymentMethod[],
  };
}

export async function getCartViewAction(slug: string, surface: Surface = "external_agent"): Promise<ActionResult> {
  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const addSchema = z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) });

export async function addProductToCartAction(
  slug: string,
  input: z.infer<typeof addSchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  // Re-validated against the live, tenant-scoped catalog — never trusted
  // just because the client sent an id (spec §14: the browser never gets
  // a privileged client, and never gets to assert facts about the catalog).
  const { data: product } = await ctx.supabase
    .from("products")
    .select("id")
    .eq("id", parsed.data.productId)
    .eq("tenant_id", ctx.tenant.id)
    .eq("status", "active")
    .maybeSingle();
  if (!product) return { ok: false, error: "productUnavailable" };

  await addToCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.productId, parsed.data.quantity);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const quantitySchema = z.object({ productId: z.uuid(), quantity: z.number().int().min(0).max(99) });

export async function updateCartItemQuantityAction(
  slug: string,
  input: z.infer<typeof quantitySchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = quantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  await setCartItemQuantity(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.productId, parsed.data.quantity);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const fulfillmentSchema = z.object({
  fulfillmentType: z.enum(["pickup", "delivery", "dine_in"]),
  /** Raw, unvalidated — re-checked against `branch_tables` below before it's trusted for anything (spec §25/§39). */
  tableId: z.string().trim().max(100).optional(),
});

export async function setFulfillmentTypeAction(
  slug: string,
  input: z.infer<typeof fulfillmentSchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = fulfillmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (!ctx.fulfillmentTypes.includes(parsed.data.fulfillmentType)) {
    return { ok: false, error: "fulfillmentUnavailable" };
  }
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  let branchId: string | null = null;
  let tableId: string | null = null;
  if (parsed.data.fulfillmentType === "dine_in") {
    const table = parsed.data.tableId ? await findActiveTable(ctx.supabase, ctx.tenant.id, parsed.data.tableId) : null;
    if (!table) return { ok: false, error: "tableUnknown" };
    branchId = table.branchId;
    tableId = table.id;
  } else if (parsed.data.fulfillmentType === "pickup") {
    const { data: branch } = await ctx.supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    branchId = branch?.id ?? null;
  }
  await setFulfillment(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.fulfillmentType, branchId, tableId);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const paymentMethodSchema = z.object({ paymentMethod: z.enum(["moyasar", "tap", "cash_on_delivery", "pay_on_table"]) });

export async function setPaymentMethodAction(
  slug: string,
  input: z.infer<typeof paymentMethodSchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = paymentMethodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidInput" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (!ctx.paymentMethods.includes(parsed.data.paymentMethod)) {
    return { ok: false, error: "paymentUnavailable" };
  }
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  await setPaymentMethod(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.paymentMethod);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const couponSchema = z.object({ code: z.string().trim().max(40) });

export async function setCouponCodeAction(
  slug: string,
  input: z.infer<typeof couponSchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = couponSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalidCode" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  // Stored as entered, not validated here — the cart's own live view below
  // calls validate_coupon for a preview, and create_order_from_cart is the
  // only place a coupon is ever actually applied (spec §15's discipline).
  await setCouponCode(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.code || null);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const detailsSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
});

export async function setCustomerDetailsAction(
  slug: string,
  input: z.infer<typeof detailsSchema>,
  surface: Surface = "external_agent",
): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "checkDetails" };

  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  await setCustomerDetails(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

export type PlaceStructuredOrderResult =
  | {
      ok: true;
      orderNumber: number;
      totalMinor: number;
      currency: string;
      discountMinor: number;
      checkoutUrl: string | null;
    }
  | { ok: false; error: AgentErrorCode };

export async function placeStructuredOrderAction(
  slug: string,
  surface: Surface = "external_agent",
): Promise<PlaceStructuredOrderResult> {
  const ctx = await loadContext(slug, surface);
  if (!ctx) return { ok: false, error: "unavailable" };
  if (!ctx.orderingEnabled) return { ok: false, error: "orderingOff" };
  if (isRateLimited(ctx.conversation.id, MUTATION_RATE_LIMIT_WINDOW_MS, MUTATION_RATE_LIMIT_MAX)) {
    return { ok: false, error: "rateLimited" };
  }

  const result = await placeOrder(ctx.supabase, ctx.tenant.id, ctx.cart.id);
  if (!result.ok) return { ok: false, error: orderErrorCode(result.error) };

  const payment = await initiatePayment(ctx.supabase, ctx.tenant.id, result.orderId);
  return {
    ok: true,
    orderNumber: result.orderNumber,
    totalMinor: result.totalMinor,
    currency: result.currency,
    discountMinor: result.discountMinor,
    checkoutUrl: payment.ok ? payment.checkoutUrl : null,
  };
}
