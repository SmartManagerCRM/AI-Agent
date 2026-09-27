"use server";

import { z } from "zod";

import { getOrCreateConversation } from "@/server/agent-public/conversation";
import { resolvePublicTenant } from "@/server/agent-public/tenant";
import {
  addToCart,
  getOrCreateCart,
  setCartItemQuantity,
  setCustomerDetails,
  setFulfillment,
  viewCart,
  type CartView,
} from "@/server/commerce/cart";
import { placeOrder } from "@/server/commerce/orders";
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

type ActionResult = { ok: true; cart: CartView } | { ok: false; error: string };

const DEFAULT_CHECKOUT = {
  ordering_enabled: false,
  fulfillment_types: ["pickup"] as ("pickup" | "delivery")[],
  delivery_fee_minor: 0,
  minimum_order_minor: 0,
  tax_rate_bps: 0,
  tax_included: false,
};

async function loadContext(slug: string) {
  const tenant = await resolvePublicTenant(slug);
  if (!tenant) return null;
  const supabase = serviceClient();
  const conversation = await getOrCreateConversation(supabase, tenant.id, tenant.slug, tenant.defaultLanguage);
  const cart = await getOrCreateCart(supabase, tenant.id, conversation.id);
  const { data: settings } = await supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle();
  const checkout = settings?.checkout ?? DEFAULT_CHECKOUT;
  return { tenant, supabase, conversation, cart, orderingEnabled: checkout.ordering_enabled, fulfillmentTypes: checkout.fulfillment_types };
}

export async function getCartViewAction(slug: string): Promise<ActionResult> {
  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const addSchema = z.object({ productId: z.uuid(), quantity: z.number().int().min(1).max(99) });

export async function addProductToCartAction(slug: string, input: z.infer<typeof addSchema>): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid product or quantity." };

  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  if (!ctx.orderingEnabled) return { ok: false, error: "Ordering isn't available yet for this business." };

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
  if (!product) return { ok: false, error: "That product is not available." };

  await addToCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.productId, parsed.data.quantity);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const quantitySchema = z.object({ productId: z.uuid(), quantity: z.number().int().min(0).max(99) });

export async function updateCartItemQuantityAction(slug: string, input: z.infer<typeof quantitySchema>): Promise<ActionResult> {
  const parsed = quantitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid quantity." };

  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  if (!ctx.orderingEnabled) return { ok: false, error: "Ordering isn't available yet for this business." };

  await setCartItemQuantity(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.productId, parsed.data.quantity);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const fulfillmentSchema = z.object({ fulfillmentType: z.enum(["pickup", "delivery"]) });

export async function setFulfillmentTypeAction(slug: string, input: z.infer<typeof fulfillmentSchema>): Promise<ActionResult> {
  const parsed = fulfillmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid fulfillment type." };

  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  if (!ctx.orderingEnabled) return { ok: false, error: "Ordering isn't available yet for this business." };
  if (!ctx.fulfillmentTypes.includes(parsed.data.fulfillmentType)) {
    return { ok: false, error: `${parsed.data.fulfillmentType} is not available for this business.` };
  }

  let branchId: string | null = null;
  if (parsed.data.fulfillmentType === "pickup") {
    const { data: branch } = await ctx.supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", ctx.tenant.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle();
    branchId = branch?.id ?? null;
  }
  await setFulfillment(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data.fulfillmentType, branchId);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

const detailsSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional(),
  deliveryAddress: z.string().trim().max(300).optional(),
});

export async function setCustomerDetailsAction(slug: string, input: z.infer<typeof detailsSchema>): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the details you entered." };

  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  if (!ctx.orderingEnabled) return { ok: false, error: "Ordering isn't available yet for this business." };

  await setCustomerDetails(ctx.supabase, ctx.tenant.id, ctx.cart.id, parsed.data);
  const cart = await viewCart(ctx.supabase, ctx.tenant.id, ctx.cart.id, ctx.conversation.locale);
  return { ok: true, cart };
}

export type PlaceStructuredOrderResult =
  | { ok: true; orderNumber: number; totalMinor: number; currency: string; checkoutUrl: string | null }
  | { ok: false; error: string };

export async function placeStructuredOrderAction(slug: string): Promise<PlaceStructuredOrderResult> {
  const ctx = await loadContext(slug);
  if (!ctx) return { ok: false, error: "This Agent is not available right now." };
  if (!ctx.orderingEnabled) return { ok: false, error: "Ordering isn't available yet for this business." };

  const result = await placeOrder(ctx.supabase, ctx.tenant.id, ctx.cart.id);
  if (!result.ok) return { ok: false, error: result.error };

  const payment = await initiatePayment(ctx.supabase, result.orderId);
  return {
    ok: true,
    orderNumber: result.orderNumber,
    totalMinor: result.totalMinor,
    currency: result.currency,
    checkoutUrl: payment.ok ? payment.checkoutUrl : null,
  };
}
