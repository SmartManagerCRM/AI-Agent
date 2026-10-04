import type { CurrencyCode, ISubscriptionUpdateItem, ITransactionItemWithNonCatalogPrice } from "@paddle/paddle-node-sdk";

/**
 * A plan's price, as Paddle bills it. Prices are not created in Paddle's
 * catalog: each checkout (and plan change) carries the plan's current price
 * from `subscription_plans` — the Super Admin plans page stays the one place
 * prices are set. The price carries its plan (`custom_data.plan_key`), so
 * renewals and plan changes Paddle reports later name the plan they are for.
 */

/** Currencies Paddle Billing accepts. */
export const PADDLE_CURRENCIES: ReadonlySet<string> = new Set<CurrencyCode>([
  "USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "CLP", "HKD", "SGD", "SEK", "ARS", "BRL", "CNY", "COP", "CZK",
  "DKK", "HUF", "ILS", "INR", "KRW", "MXN", "NOK", "NZD", "PEN", "PLN", "RUB", "THB", "TRY", "TWD", "UAH", "VND", "ZAR",
]);

export type BillablePlan = {
  key: string;
  name: Record<string, string>;
  price_minor: number;
  currency: string;
  billing_interval: "month" | "year";
};

const PRODUCT_NAME = "SmartManager AI Agent";

export const planDisplayName = (plan: BillablePlan) => plan.name.en ?? Object.values(plan.name)[0] ?? plan.key;

function priceBody(plan: BillablePlan) {
  const name = planDisplayName(plan);
  return {
    name,
    description: `${PRODUCT_NAME} — ${name} (${plan.billing_interval === "year" ? "yearly" : "monthly"})`,
    // Paddle amounts are strings in the currency's smallest unit — the same unit as price_minor.
    unitPrice: { amount: String(plan.price_minor), currencyCode: plan.currency as CurrencyCode },
    billingCycle: { interval: plan.billing_interval, frequency: 1 },
    customData: { plan_key: plan.key },
    product: { name: `${PRODUCT_NAME} — ${name}`, taxCategory: "standard" as const, customData: { plan_key: plan.key } },
  };
}

/** The item of a new subscription's first transaction (its checkout). */
export function checkoutItem(plan: BillablePlan): ITransactionItemWithNonCatalogPrice {
  return { quantity: 1, price: priceBody(plan) };
}

/** The item replacing a subscription's current one when its plan changes. */
export function planChangeItem(plan: BillablePlan): ISubscriptionUpdateItem {
  return { quantity: 1, price: priceBody(plan) };
}
