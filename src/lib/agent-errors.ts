/**
 * What went wrong for the customer, as a key under `agent.errors.*`
 * (messages/{en,ar,fr}.json): the Agent's actions answer with one of these
 * and the Agent shows it in the customer's chosen language.
 */
export type AgentErrorCode =
  | "unavailable"
  | "orderingOff"
  | "rateLimited"
  | "invalidInput"
  | "productUnavailable"
  | "fulfillmentUnavailable"
  | "paymentUnavailable"
  | "tableUnknown"
  | "invalidCode"
  | "checkDetails"
  | "cartEmpty"
  | "cartInactive"
  | "choosePayment"
  | "chooseFulfillment"
  | "orderFailed"
  | "messageEmpty"
  | "chatTooFast"
  | "coupon.enter"
  | "coupon.redeemed"
  | "coupon.expired"
  | "coupon.inactive"
  | "coupon.notYet"
  | "coupon.invalid"
  | "coupon.minimum";

/** A coupon's verdict from the database (`validate_coupon`, English) → its key. */
export function couponErrorCode(message: string): AgentErrorCode {
  const rules: [RegExp, AgentErrorCode][] = [
    [/^Enter a code/, "coupon.enter"],
    [/fully redeemed/, "coupon.redeemed"],
    [/has expired/, "coupon.expired"],
    [/no longer active/, "coupon.inactive"],
    [/not active yet/, "coupon.notYet"],
    [/minimum required/, "coupon.minimum"],
  ];
  return rules.find(([re]) => re.test(message))?.[1] ?? "coupon.invalid";
}

/** Why the database refused to place the order (`create_order_from_cart`, English) → its key. */
export function orderErrorCode(message: string | undefined): AgentErrorCode {
  const reason = /^[A-Z_]+: (.+)$/.exec(message ?? "")?.[1] ?? "";
  if (/^the cart is empty/.test(reason)) return "cartEmpty";
  if (/^this cart is no longer active|^cart does not exist/.test(reason)) return "cartInactive";
  if (/^choose a payment method/.test(reason)) return "choosePayment";
  if (/^choose pickup/.test(reason)) return "chooseFulfillment";
  if (/is not an available payment method/.test(reason)) return "paymentUnavailable";
  if (/^(Enter a code|This code|Your order does not meet)/.test(reason)) return couponErrorCode(reason);
  return "orderFailed";
}
