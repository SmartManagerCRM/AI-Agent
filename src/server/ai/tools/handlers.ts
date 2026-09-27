import "server-only";

import {
  addToCart,
  clearCart,
  findActiveProductByName,
  getOrCreateCart,
  removeFromCart,
  setCustomerDetails,
  setFulfillment,
  setOrderNotes,
  setCartItemQuantity,
  viewCart,
} from "@/server/commerce/cart";
import { getOrderStatusByNumber, placeOrder } from "@/server/commerce/orders";
import { initiatePayment } from "@/server/payments/service";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type ToolContext = {
  supabase: TypedSupabaseClient;
  tenantId: string;
  conversationId: string;
  locale: string;
  currency: string;
  currencyExponent: number;
  checkout: {
    ordering_enabled: boolean;
    fulfillment_types: ("pickup" | "delivery")[];
    delivery_fee_minor: number;
    minimum_order_minor: number;
  };
};

export type ToolResult = { content: string; isError?: boolean };

function formatMinor(minor: number, exponent: number): string {
  return (minor / 10 ** exponent).toFixed(exponent);
}

const ORDERING_REQUIRED_TOOLS = new Set([
  "view_cart",
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
  "clear_cart",
  "set_fulfillment",
  "set_customer_details",
  "place_order",
  "check_order_status",
]);

/** Executes one tool call. Every handler re-derives the cart from the conversation — never trusts an id the model might supply. */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.checkout.ordering_enabled && ORDERING_REQUIRED_TOOLS.has(name)) {
    return { content: "Ordering isn't available yet for this business — you can still ask about products and hours.", isError: true };
  }

  switch (name) {
    case "search_products": {
      const query = String(input.query ?? "").trim();
      const { data } = await ctx.supabase.from("products").select("name, price_minor").eq("tenant_id", ctx.tenantId).eq("status", "active");
      const matches = (data ?? [])
        .filter((p) => (p.name[ctx.locale] ?? Object.values(p.name)[0] ?? "").toLowerCase().includes(query.toLowerCase()))
        .slice(0, 5);
      if (matches.length === 0) return { content: `No products found matching "${query}".` };
      return {
        content: matches
          .map((p) => `${p.name[ctx.locale] ?? Object.values(p.name)[0]} — ${formatMinor(p.price_minor, ctx.currencyExponent)} ${ctx.currency}`)
          .join("; "),
      };
    }

    case "get_product": {
      const product = await findActiveProductByName(ctx.supabase, ctx.tenantId, ctx.locale, String(input.product_name ?? ""));
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      return { content: `${product.name} — ${formatMinor(product.priceMinor, ctx.currencyExponent)} ${ctx.currency}` };
    }

    case "view_cart": {
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      const view = await viewCart(ctx.supabase, ctx.tenantId, cart.id, ctx.locale);
      if (view.items.length === 0) return { content: "The cart is empty." };
      const lines = view.items.map((i) => `${i.quantity} × ${i.name} = ${formatMinor(i.totalMinor, ctx.currencyExponent)} ${ctx.currency}`);
      return { content: `${lines.join("; ")}. Subtotal: ${formatMinor(view.subtotalMinor, ctx.currencyExponent)} ${ctx.currency}.` };
    }

    case "add_to_cart": {
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1) return { content: "Quantity must be a positive whole number.", isError: true };
      const product = await findActiveProductByName(ctx.supabase, ctx.tenantId, ctx.locale, String(input.product_name ?? ""));
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await addToCart(ctx.supabase, ctx.tenantId, cart.id, product.id, quantity);
      return { content: `Added ${quantity} × ${product.name} to the cart.` };
    }

    case "update_cart_item": {
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 0) return { content: "Quantity must be zero or a positive whole number.", isError: true };
      const product = await findActiveProductByName(ctx.supabase, ctx.tenantId, ctx.locale, String(input.product_name ?? ""));
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await setCartItemQuantity(ctx.supabase, ctx.tenantId, cart.id, product.id, quantity);
      return { content: quantity === 0 ? `Removed ${product.name} from the cart.` : `Set ${product.name} to ${quantity}.` };
    }

    case "remove_from_cart": {
      const product = await findActiveProductByName(ctx.supabase, ctx.tenantId, ctx.locale, String(input.product_name ?? ""));
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await removeFromCart(ctx.supabase, ctx.tenantId, cart.id, product.id);
      return { content: `Removed ${product.name} from the cart.` };
    }

    case "clear_cart": {
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await clearCart(ctx.supabase, ctx.tenantId, cart.id);
      return { content: "Cart cleared." };
    }

    case "set_fulfillment": {
      const type = input.fulfillment_type === "delivery" ? "delivery" : "pickup";
      if (!ctx.checkout.fulfillment_types.includes(type)) {
        return { content: `${type} is not available for this business.`, isError: true };
      }
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      let branchId: string | null = null;
      if (type === "pickup") {
        const { data: branch } = await ctx.supabase
          .from("branches")
          .select("id")
          .eq("tenant_id", ctx.tenantId)
          .eq("is_default", true)
          .eq("is_active", true)
          .maybeSingle();
        branchId = branch?.id ?? null;
      }
      await setFulfillment(ctx.supabase, ctx.tenantId, cart.id, type, branchId);
      return { content: `Fulfillment set to ${type}.` };
    }

    case "set_customer_details": {
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await setCustomerDetails(ctx.supabase, ctx.tenantId, cart.id, {
        name: input.name ? String(input.name) : undefined,
        phone: input.phone ? String(input.phone) : undefined,
        email: input.email ? String(input.email) : undefined,
        deliveryAddress: input.delivery_address ? String(input.delivery_address) : undefined,
      });
      if (input.notes) await setOrderNotes(ctx.supabase, ctx.tenantId, cart.id, String(input.notes));
      return { content: "Customer details recorded." };
    }

    case "place_order": {
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      const result = await placeOrder(ctx.supabase, ctx.tenantId, cart.id);
      if (!result.ok) return { content: result.error, isError: true };

      const total = `${formatMinor(result.totalMinor, ctx.currencyExponent)} ${result.currency}`;
      const payment = await initiatePayment(ctx.supabase, result.orderId);
      if (payment.ok) {
        return {
          content: `Order #${result.orderNumber} placed — total ${total}. Pay now: ${payment.checkoutUrl}`,
        };
      }
      return {
        content: `Order #${result.orderNumber} placed — total ${total}. Payment will be arranged by the business (couldn't start online payment: ${payment.error}).`,
      };
    }

    case "check_order_status": {
      const orderNumber = Number(input.order_number);
      if (!Number.isInteger(orderNumber)) return { content: "Please give the order number to check.", isError: true };
      const status = await getOrderStatusByNumber(ctx.supabase, ctx.tenantId, orderNumber);
      if (!status) return { content: `No order #${orderNumber} found.`, isError: true };
      return {
        content: `Order #${orderNumber}: ${status.status.replace("_", " ")} — total ${formatMinor(status.totalMinor, ctx.currencyExponent)} ${status.currency}.`,
      };
    }

    case "request_human_handoff":
      return { content: "I've noted that you'd like to speak with a person — the business will follow up with you directly." };

    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}
