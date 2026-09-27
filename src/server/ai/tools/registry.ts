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
    description: "Add a quantity of a named product to the cart. Call this only after the customer confirms what they want.",
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
    description: "Set whether the order is for pickup or delivery.",
    parameters: {
      type: "object",
      properties: { fulfillment_type: { type: "string", enum: ["pickup", "delivery"] } },
      required: ["fulfillment_type"],
    },
  },
  {
    name: "set_customer_details",
    description: "Record the customer's name/phone/email and, for delivery, their address. Call with whichever fields the customer has given so far.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        delivery_address: { type: "string", description: "Free-text delivery address, required before placing a delivery order." },
      },
      required: [],
    },
  },
  {
    name: "place_order",
    description: "Place the order once the cart, fulfillment method, and customer details are all confirmed. This is final — only call it when the customer has explicitly confirmed.",
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
    name: "request_human_handoff",
    description: "Use when the customer needs a human — a complaint, something outside what you can help with, or they explicitly ask for a person.",
    parameters: { type: "object", properties: { reason: { type: "string" } }, required: [] },
  },
];
