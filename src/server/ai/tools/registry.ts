import type { AIToolDefinition } from "@/server/ai/provider";

/**
 * The agent's tool registry (spec §13, §92). Every tool is a thin wrapper
 * over an existing, already-tenant-scoped commerce service function — the
 * model can never do anything a customer couldn't already do by hand, and
 * it never states a price, stock level, or order confirmation from its own
 * memory (spec §12, §62). Products are addressed **by name**, not id: tool
 * calls only live within one gateway invocation and are not persisted
 * across turns (only plain message text is), so an id handed out by
 * `search_products` in an earlier customer message would not survive to a
 * later one — name matching against the live catalog does. A future phase
 * that persists tool call history per conversation could move to ids.
 */
export const AGENT_TOOLS: AIToolDefinition[] = [
  {
    name: "search_products",
    description: "Search the business's products/services by keyword. Returns up to 5 matching names and prices.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Keyword to search for, e.g. 'coffee' or 'latte'." } },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Get the price and details of one specific product/service by its name.",
    parameters: {
      type: "object",
      properties: { product_name: { type: "string" } },
      required: ["product_name"],
    },
  },
  {
    name: "view_cart",
    description: "View the current cart: items, quantities, and subtotal.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "add_to_cart",
    description:
      "Add a quantity of a named product to the cart. Call this only after the customer confirms what they want.",
    parameters: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
      },
      required: ["product_name", "quantity"],
    },
  },
  {
    name: "update_cart_item",
    description: "Set the exact quantity of a product already in the cart. A quantity of 0 removes it.",
    parameters: {
      type: "object",
      properties: {
        product_name: { type: "string" },
        quantity: { type: "integer", minimum: 0 },
      },
      required: ["product_name", "quantity"],
    },
  },
  {
    name: "remove_from_cart",
    description: "Remove a product from the cart entirely.",
    parameters: { type: "object", properties: { product_name: { type: "string" } }, required: ["product_name"] },
  },
  {
    name: "clear_cart",
    description: "Remove everything from the cart.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_fulfillment",
    description:
      "Set whether the order is for pickup, delivery, or dine-in. Only offer dine-in if the customer opened this Agent from their table's own QR code — never claim a table on the customer's behalf; if they ask for dine-in and it's not available, tell them to scan the table's QR code. For pickup and delivery at a business with several branches, the customer chooses the branch among those open now — if this tool lists them, ask which and call it again with `branch`.",
    parameters: {
      type: "object",
      properties: {
        fulfillment_type: { type: "string", enum: ["pickup", "delivery", "dine_in"] },
        branch: { type: "string", description: "The branch the customer chose (by name), when the business has several open." },
      },
      required: ["fulfillment_type"],
    },
  },
  {
    name: "set_payment_method",
    description:
      "Set how the customer will pay: an online gateway (moyasar, tap, stripe, paypal, hyperpay, myfatoorah), or in person later (cash_on_delivery, pay_on_table). Only offer methods the business actually has enabled — check what's available first if unsure.",
    parameters: {
      type: "object",
      properties: {
        payment_method: { type: "string", enum: ["moyasar", "tap", "stripe", "paypal", "hyperpay", "myfatoorah", "cash_on_delivery", "pay_on_table"] },
      },
      required: ["payment_method"],
    },
  },
  {
    name: "apply_coupon",
    description:
      "Apply a discount/coupon code the customer gave you to the cart. Tell the customer the result — whether it worked and, if not, why.",
    parameters: {
      type: "object",
      properties: { code: { type: "string", description: "The coupon code the customer gave you, e.g. 'SAVE10'." } },
      required: ["code"],
    },
  },
  {
    name: "set_customer_details",
    description:
      "Record the customer's name/phone/email and, for delivery, their address. Call with whichever fields the customer has given so far.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        delivery_address: {
          type: "string",
          description: "Free-text delivery address, required before placing a delivery order.",
        },
      },
      required: [],
    },
  },
  {
    name: "place_order",
    description:
      "Place the order once the cart, fulfillment method, payment method, and customer details are all confirmed. This is final — only call it when the customer has explicitly confirmed.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_order_status",
    description: "Look up the status and total of a previously placed order by its order number.",
    parameters: {
      type: "object",
      properties: { order_number: { type: "integer", description: "The order number, e.g. 1001." } },
      required: ["order_number"],
    },
  },
  {
    name: "list_services",
    description: "List this business's bookable services (e.g. haircut, consultation), with duration and price.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "check_availability",
    description:
      "Get the real open time slots for a named bookable service on a given date. Always call this before offering the customer a time.",
    parameters: {
      type: "object",
      properties: {
        service_name: { type: "string" },
        date: { type: "string", description: "Date in YYYY-MM-DD format. Use today or a future date." },
        branch: { type: "string", description: "The branch the customer chose (by name), when the business has several. Any branch takes bookings; the time must fit its hours." },
      },
      required: ["service_name", "date"],
    },
  },
  {
    name: "create_booking",
    description:
      "Book a specific, already-confirmed-available time slot for a service. Only call this after the customer has picked an exact slot from check_availability's real results and confirmed their name and phone.",
    parameters: {
      type: "object",
      properties: {
        service_name: { type: "string" },
        slot_start: { type: "string", description: "The exact ISO start time of the slot the customer picked." },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        branch: { type: "string", description: "The branch the customer chose (by name), when the business has several. Any branch takes bookings; the time must fit its hours." },
      },
      required: ["service_name", "slot_start", "name", "phone"],
    },
  },
  {
    name: "cancel_booking",
    description: "Cancel a previously made booking by its booking id (given to the customer when it was created).",
    parameters: {
      type: "object",
      properties: { booking_id: { type: "string" } },
      required: ["booking_id"],
    },
  },
  {
    name: "capture_lead",
    description:
      "Record a lead when the customer's request needs a human follow-up rather than a simple catalog purchase — a custom project, a consultation, a quote request, or anything the business needs to call them back about. Ask only for what you don't already have.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "A concise summary of what the customer needs." },
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    name: "request_human_handoff",
    description:
      "Use when the customer needs a human — a complaint, something outside what you can help with, or they explicitly ask for a person.",
    parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  },
];
