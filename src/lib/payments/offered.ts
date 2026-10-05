/**
 * Which of a business's enabled payment methods its customers are offered.
 * PayPal accepts only some currencies (not SAR, AED, KWD, QAR, …): a business
 * pricing in another currency never shows it at checkout, even if enabled.
 */
export const PAYPAL_CURRENCIES: ReadonlySet<string> = new Set([
  "AUD", "BRL", "CAD", "CNY", "CZK", "DKK", "EUR", "HKD", "HUF", "ILS", "JPY", "MYR", "MXN", "TWD",
  "NZD", "NOK", "PHP", "PLN", "GBP", "SGD", "SEK", "CHF", "THB", "USD",
]);

export function offeredPaymentMethods<T extends string>(enabled: readonly T[], currency: string): T[] {
  return enabled.filter((method) => method !== "paypal" || PAYPAL_CURRENCIES.has(currency.trim().toUpperCase()));
}
