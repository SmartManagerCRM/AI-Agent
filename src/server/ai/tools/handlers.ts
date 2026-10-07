import "server-only";

import {
  addToCart,
  clearCart,
  findActiveProductByName,
  getOrCreateCart,
  removeFromCart,
  setCouponCode,
  setCustomerDetails,
  setFulfillment,
  setOrderNotes,
  setCartItemQuantity,
  setPaymentMethod,
  viewCart,
  type PaymentMethod,
} from "@/server/commerce/cart";
import {
  cancelBookingById,
  createBooking,
  findActiveServiceByName,
  getAvailableSlots,
  listActiveServices,
} from "@/server/commerce/booking";
import { bookingAlternatives, type BranchAvailability } from "@/server/commerce/booking-alternatives";
import { businessHasBranches, matchBranch, openBranchChoices, type BranchPurpose } from "@/server/commerce/branch-choice";
import { resolveTimeZone } from "@/lib/timezone";
import { getOrderStatusByNumber, placeOrder } from "@/server/commerce/orders";
import { publicAgentUrls } from "@/server/agent-public/urls";
import { initiatePayment } from "@/server/payments/service";
import type { TypedSupabaseClient } from "@/server/supabase/clients";
import { relevantProducts, type Catalog } from "@/server/ai/deterministic/catalog";

/**
 * The branch for an order or booking made in chat: the one the customer
 * named, among those open now (for delivery, delivering; for bookings, any
 * active branch — the time booked must then fit its hours); the only one; or
 * — several, none named — a question for the customer.
 */
async function chatBranch(
  ctx: ToolContext,
  purpose: BranchPurpose,
  named: unknown,
): Promise<{ branchId: string | null } | { reply: string; isError?: boolean }> {
  if (!(await businessHasBranches(ctx.supabase, ctx.tenantId))) return { branchId: null };
  const open = await openBranchChoices(ctx.supabase, ctx.tenantId, purpose, ctx.locale);
  const what = purpose === "booking" ? "bookings" : purpose;
  const which = purpose === "booking" ? "branches" : "branches open right now";
  if (open.length === 0) {
    return { reply: `No branch is ${purpose === "delivery" ? "delivering" : "open"} right now, so ${what} can't be taken at the moment. Tell the customer, and offer the opening hours.`, isError: true };
  }
  const list = open.map((b) => (b.address ? `${b.name} (${b.address})` : b.name)).join("; ");
  const name = typeof named === "string" ? named : "";
  if (name.trim()) {
    const match = matchBranch(open, name);
    if (match) return { branchId: match.id };
    return { reply: `"${name}" is not one of the ${which} for ${what}. Ask the customer to choose one of: ${list}.`, isError: true };
  }
  if (open.length === 1) return { branchId: open[0].id };
  return { reply: `This business has several ${which} for ${what}: ${list}. Ask the customer which branch, then call again with "branch".` };
}

/** "Other branches …" for the AI, from real availability (empty when there's none, or no other branch). */
function alternativesText(list: BranchAvailability[], time: string | null): string {
  if (list.length === 0) return " No other branch has availability for it either — suggest another day.";
  const parts = list.map((b) => {
    const hours = b.hours && b.hours.length > 0 ? ` (open ${b.hours.join(", ")})` : "";
    const times = b.times.length > 0 ? `: ${b.times.join(", ")}` : "";
    return `${b.name}${hours}${times}`;
  });
  return ` Other branches that ${time ? `have ${time} free` : "can take it that day"}: ${parts.join("; ")}. Offer these to the customer; if they pick one, call check_availability again with that "branch".`;
}

function serviceShape(service: { id: string; durationMinutes: number | null; customerSetsEnd?: boolean }) {
  return { id: service.id, duration_minutes: service.durationMinutes, customer_sets_end: service.customerSetsEnd ?? false };
}

/** A slot's instant as the business's local date and "HH:MM". */
async function localSlot(ctx: ToolContext, iso: string): Promise<{ date: string; time: string } | null> {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const { data } = await ctx.supabase.from("tenants").select("timezone").eq("id", ctx.tenantId).maybeSingle();
  const timeZone = resolveTimeZone(data?.timezone);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return { date, time };
}

export type ToolContext = {
  supabase: TypedSupabaseClient;
  tenantId: string;
  conversationId: string;
  locale: string;
  currency: string;
  currencyExponent: number;
  checkout: {
    ordering_enabled: boolean;
    fulfillment_types: ("pickup" | "delivery" | "dine_in")[];
    delivery_fee_minor: number;
    minimum_order_minor: number;
  };
  paymentMethods: string[];
  /** The real, already-validated `branch_tables` row for this conversation, if it started from a dine-in QR link — never a raw id the model could supply itself (spec §25/§39). Null outside dine-in mode. */
  activeTable: { id: string; branchId: string; label: string } | null;
};

export type ToolResult = {
  content: string;
  isError?: boolean;
  /** Items returned (diagnostics only). */
  resultCount?: number;
  /** An order this call placed: the chat offers to track it. */
  placedOrder?: { orderNumber: number; trackUrl: string };
};

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
  "set_payment_method",
  "apply_coupon",
  "set_customer_details",
  "place_order",
  "check_order_status",
]);

/** Executes one tool call. Every handler re-derives the cart from the conversation — never trusts an id the model might supply. */
export async function executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  if (!ctx.checkout.ordering_enabled && ORDERING_REQUIRED_TOOLS.has(name)) {
    return {
      content: "Ordering isn't available yet for this business — you can still ask about products and hours.",
      isError: true,
    };
  }

  switch (name) {
    case "search_products": {
      // Same multilingual, normalized search as the deterministic catalog answers — any language the product is named in.
      const query = String(input.query ?? "").trim();
      const [{ data }, { data: categories }] = await Promise.all([
        ctx.supabase
          .from("products")
          .select("id, category_id, name, description, price_minor")
          .eq("tenant_id", ctx.tenantId)
          .eq("status", "active"),
        ctx.supabase.from("categories").select("id, name").eq("tenant_id", ctx.tenantId).eq("is_active", true),
      ]);
      const catalog: Catalog = {
        currency: ctx.currency,
        currencyExponent: ctx.currencyExponent,
        locale: ctx.locale,
        categories: (categories ?? []).map((c) => ({ id: c.id, names: c.name })),
        products: (data ?? []).map((p) => ({
          id: p.id,
          names: p.name,
          description: Object.values(p.description ?? {})[0] ?? null,
          categoryId: p.category_id,
          priceMinor: p.price_minor,
        })),
      };
      const matches = relevantProducts(query, catalog, 8);
      if (matches.length === 0) return { content: `No products found matching "${query}".`, resultCount: 0 };
      return {
        content: matches
          .map((p) => `${p.names[ctx.locale] ?? Object.values(p.names)[0]} — ${formatMinor(p.priceMinor, ctx.currencyExponent)} ${ctx.currency}`)
          .join("; "),
        resultCount: matches.length,
      };
    }

    case "get_product": {
      const product = await findActiveProductByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.product_name ?? ""),
      );
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      return { content: `${product.name} — ${formatMinor(product.priceMinor, ctx.currencyExponent)} ${ctx.currency}` };
    }

    case "view_cart": {
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      const view = await viewCart(ctx.supabase, ctx.tenantId, cart.id, ctx.locale);
      if (view.items.length === 0) return { content: "The cart is empty." };
      const lines = view.items.map(
        (i) => `${i.quantity} × ${i.name} = ${formatMinor(i.totalMinor, ctx.currencyExponent)} ${ctx.currency}`,
      );
      return {
        content: `${lines.join("; ")}. Subtotal: ${formatMinor(view.subtotalMinor, ctx.currencyExponent)} ${ctx.currency}.`,
      };
    }

    case "add_to_cart": {
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 1)
        return { content: "Quantity must be a positive whole number.", isError: true };
      const product = await findActiveProductByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.product_name ?? ""),
      );
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await addToCart(ctx.supabase, ctx.tenantId, cart.id, product.id, quantity);
      return { content: `Added ${quantity} × ${product.name} to the cart.` };
    }

    case "update_cart_item": {
      const quantity = Number(input.quantity);
      if (!Number.isInteger(quantity) || quantity < 0)
        return { content: "Quantity must be zero or a positive whole number.", isError: true };
      const product = await findActiveProductByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.product_name ?? ""),
      );
      if (!product) return { content: `No product found named "${input.product_name}".`, isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await setCartItemQuantity(ctx.supabase, ctx.tenantId, cart.id, product.id, quantity);
      return {
        content: quantity === 0 ? `Removed ${product.name} from the cart.` : `Set ${product.name} to ${quantity}.`,
      };
    }

    case "remove_from_cart": {
      const product = await findActiveProductByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.product_name ?? ""),
      );
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
      const rawType = input.fulfillment_type === "delivery" || input.fulfillment_type === "dine_in"
        ? input.fulfillment_type
        : "pickup";
      if (rawType === "dine_in" && !ctx.activeTable) {
        return {
          content: "Dine-in is only available when you've opened this Agent from your table's QR code.",
          isError: true,
        };
      }
      if (!ctx.checkout.fulfillment_types.includes(rawType)) {
        return { content: `${rawType} is not available for this business.`, isError: true };
      }
      let branchId: string | null = null;
      let tableId: string | null = null;
      if (rawType === "dine_in") {
        branchId = ctx.activeTable!.branchId;
        tableId = ctx.activeTable!.id;
      } else {
        // The customer's branch, among those open now (for delivery, delivering).
        const branch = await chatBranch(ctx, rawType, input.branch);
        if ("reply" in branch) return { content: branch.reply, isError: branch.isError };
        branchId = branch.branchId;
      }
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await setFulfillment(ctx.supabase, ctx.tenantId, cart.id, rawType, branchId, tableId);
      return { content: `Fulfillment set to ${rawType === "dine_in" ? `dine-in (table ${ctx.activeTable!.label})` : rawType}.` };
    }

    case "set_payment_method": {
      const method = String(input.payment_method ?? "") as PaymentMethod;
      if (!ctx.paymentMethods.includes(method)) {
        return { content: `${method || "that payment method"} is not available for this business.`, isError: true };
      }
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      await setPaymentMethod(ctx.supabase, ctx.tenantId, cart.id, method);
      return { content: `Payment method set to ${method.replace(/_/g, " ")}.` };
    }

    case "apply_coupon": {
      const code = String(input.code ?? "").trim();
      if (!code) return { content: "What's the coupon code?", isError: true };
      const cart = await getOrCreateCart(ctx.supabase, ctx.tenantId, ctx.conversationId);
      const view = await viewCart(ctx.supabase, ctx.tenantId, cart.id, ctx.locale);
      const { data } = await ctx.supabase.rpc("validate_coupon", {
        p_tenant_id: ctx.tenantId,
        p_code: code,
        p_subtotal_minor: view.subtotalMinor,
      });
      const result = data?.[0];
      if (!result?.valid) return { content: result?.message ?? "That code didn't work.", isError: true };
      await setCouponCode(ctx.supabase, ctx.tenantId, cart.id, code);
      return {
        content: `Applied — that saves ${formatMinor(result.discount_minor, ctx.currencyExponent)} ${ctx.currency}.`,
      };
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
      const savings =
        result.discountMinor > 0
          ? ` (saved ${formatMinor(result.discountMinor, ctx.currencyExponent)} ${result.currency})`
          : "";
      const payment = await initiatePayment(ctx.supabase, ctx.tenantId, result.orderId);
      const trackUrl = publicAgentUrls().path(`/track/${result.orderId}`);
      const placedOrder = { orderNumber: result.orderNumber, trackUrl };
      const track = ` Track it: ${trackUrl}`;
      if (payment.ok && payment.checkoutUrl) {
        return {
          content: `Order #${result.orderNumber} placed — total ${total}${savings}. Pay now: ${payment.checkoutUrl}${track}`,
          placedOrder,
        };
      }
      if (payment.ok) {
        return {
          content: `Order #${result.orderNumber} confirmed — total ${total}${savings}. You'll pay in person, as chosen.${track}`,
          placedOrder,
        };
      }
      return {
        content: `Order #${result.orderNumber} placed — total ${total}${savings}. Payment will be arranged by the business (couldn't start online payment: ${payment.error}).${track}`,
        placedOrder,
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

    case "list_services": {
      const services = await listActiveServices(ctx.supabase, ctx.tenantId, ctx.locale);
      if (services.length === 0) return { content: "This business doesn't have any bookable services set up yet." };
      return {
        content: services
          .map(
            (s) =>
              `${s.name} (${s.durationMinutes !== null ? `${s.durationMinutes} min` : "flexible length"}${s.priceMinor !== null ? `, ${formatMinor(s.priceMinor, ctx.currencyExponent)} ${ctx.currency}` : ""})`,
          )
          .join("; "),
      };
    }

    case "check_availability": {
      const service = await findActiveServiceByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.service_name ?? ""),
      );
      if (!service) return { content: `No bookable service found named "${input.service_name}".`, isError: true };
      const date = String(input.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { content: "Give the date as YYYY-MM-DD.", isError: true };
      const branch = await chatBranch(ctx, "booking", input.branch);
      if ("reply" in branch) return { content: branch.reply, isError: branch.isError };
      const slots = await getAvailableSlots(ctx.supabase, ctx.tenantId, service, date, branch.branchId);
      if (slots.length === 0) {
        // That branch is closed or full that day: the other branches that can take it.
        const others = branch.branchId ? await bookingAlternatives(ctx.supabase, ctx.tenantId, serviceShape(service), date, null, branch.branchId, ctx.locale) : null;
        return { content: `No open slots for ${service.name} on ${date} at this branch.${others ? alternativesText(others, null) : ""}` };
      }
      // Local clock times for the customer, with the exact instant to book.
      const times = slots.slice(0, 40).map((s) => `${s.localTime} (slot_start ${s.startsAt}${s.spotsLeft > 1 ? `, ${s.spotsLeft} places` : ""})`);
      return { content: `Open start times for ${service.name} on ${date} (business local time): ${times.join(", ")}.` };
    }

    case "create_booking": {
      const service = await findActiveServiceByName(
        ctx.supabase,
        ctx.tenantId,
        ctx.locale,
        String(input.service_name ?? ""),
      );
      if (!service) return { content: `No bookable service found named "${input.service_name}".`, isError: true };
      const branch = await chatBranch(ctx, "booking", input.branch);
      if ("reply" in branch) return { content: branch.reply, isError: branch.isError };
      const result = await createBooking(
        ctx.supabase,
        ctx.tenantId,
        service,
        ctx.conversationId,
        String(input.slot_start ?? ""),
        {
          name: input.name ? String(input.name) : undefined,
          phone: input.phone ? String(input.phone) : undefined,
          email: input.email ? String(input.email) : undefined,
        },
        branch.branchId,
      );
      if (!result.ok) {
        // Closed or full at that branch: which other branches have that time free.
        if (branch.branchId && (result.reason === "closed" || result.reason === "full")) {
          const local = await localSlot(ctx, String(input.slot_start ?? ""));
          if (local) {
            const others = await bookingAlternatives(ctx.supabase, ctx.tenantId, serviceShape(service), local.date, local.time, branch.branchId, ctx.locale);
            return { content: `${result.error}${alternativesText(others, local.time)}`, isError: true };
          }
        }
        return { content: result.error, isError: true };
      }
      if (result.status === "pending") {
        // The business confirms each booking for this service itself: this is a request, not a booking yet.
        return {
          content: `Booking REQUEST sent for ${service.name} at ${result.startsAt} — request id ${result.bookingId}. It is NOT confirmed yet: the business confirms each booking for this service and will reply soon. Tell the customer you're checking availability and they'll be contacted to confirm.`,
        };
      }
      return {
        content: `Booked ${service.name} at ${result.startsAt} — booking id ${result.bookingId}. Keep this id to cancel later.`,
      };
    }

    case "cancel_booking": {
      const bookingId = String(input.booking_id ?? "").trim();
      if (!bookingId) return { content: "What's the booking id?", isError: true };
      const canceled = await cancelBookingById(ctx.supabase, ctx.tenantId, bookingId);
      if (!canceled) return { content: "Couldn't find an active booking with that id.", isError: true };
      return { content: "Booking canceled." };
    }

    case "capture_lead": {
      const message = String(input.message ?? "").trim();
      if (!message) return { content: "What do you need help with?", isError: true };
      const { error } = await ctx.supabase.from("leads").insert({
        tenant_id: ctx.tenantId,
        conversation_id: ctx.conversationId,
        customer_name: input.name ? String(input.name) : null,
        customer_phone: input.phone ? String(input.phone) : null,
        customer_email: input.email ? String(input.email) : null,
        message,
      });
      if (error) return { content: "I couldn't record that just now — please try again.", isError: true };
      return { content: "Got it — I've passed this along to the team, and they'll follow up with you directly." };
    }

    case "request_human_handoff":
      return {
        content: "I've noted that you'd like to speak with a person — the business will follow up with you directly.",
      };

    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}
