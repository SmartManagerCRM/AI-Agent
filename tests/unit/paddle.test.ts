import { Webhooks } from "@paddle/paddle-node-sdk";
import { describe, expect, it } from "vitest";

import { paddleKeysPresent, readPaddleConfig } from "@/server/billing/paddle/config";
import { paddleAction } from "@/server/billing/paddle/events";
import { PADDLE_CURRENCIES, checkoutItem, planChangeItem } from "@/server/billing/paddle/prices";
import { signPaddleBody, verifyPaddleSignature } from "@/server/billing/paddle/signature";

const SECRET = "pdl_ntfset_test_secret_value";

describe("Paddle settings", () => {
  it("needs all three keys", () => {
    expect(readPaddleConfig({ PADDLE_API_KEY: "pdl_sdbx_apikey_abc" })).toEqual({ ok: false, reason: "missing" });
  });
  it("reads sandbox or live from the keys", () => {
    const sandbox = readPaddleConfig({ PADDLE_API_KEY: "pdl_sdbx_apikey_abc", PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_WEBHOOK_SECRET: SECRET });
    expect(sandbox.ok && sandbox.config.environment).toBe("sandbox");
    const live = readPaddleConfig({ PADDLE_API_KEY: "pdl_live_apikey_abc", PADDLE_CLIENT_TOKEN: "live_abc", PADDLE_WEBHOOK_SECRET: SECRET });
    expect(live.ok && live.config.environment).toBe("production");
  });
  it("refuses a sandbox key with a live token", () => {
    expect(readPaddleConfig({ PADDLE_API_KEY: "pdl_sdbx_apikey_abc", PADDLE_CLIENT_TOKEN: "live_abc", PADDLE_WEBHOOK_SECRET: SECRET })).toEqual({
      ok: false,
      reason: "mismatch",
    });
  });
  it("a key set means Paddle is meant to take payments (so no test checkout), even if the keys don't work", () => {
    expect(paddleKeysPresent({})).toBe(false);
    expect(paddleKeysPresent({ PADDLE_API_KEY: " " })).toBe(false);
    expect(paddleKeysPresent({ PADDLE_WEBHOOK_SECRET: SECRET })).toBe(true);
    expect(paddleKeysPresent({ PADDLE_API_KEY: "pdl_sdbx_apikey_abc", PADDLE_CLIENT_TOKEN: "live_abc", PADDLE_WEBHOOK_SECRET: SECRET })).toBe(true);
  });
  it("falls back to the client token for an older API key", () => {
    const result = readPaddleConfig({ PADDLE_API_KEY: "0123456789abcdef0123", PADDLE_CLIENT_TOKEN: "test_abc", PADDLE_WEBHOOK_SECRET: SECRET });
    expect(result.ok && result.config.environment).toBe("sandbox");
  });
});

describe("Paddle webhook signatures", () => {
  const body = JSON.stringify({ event_id: "evt_1", event_type: "transaction.completed" });
  const now = new Date("2026-10-04T12:00:00Z");
  it("accepts Paddle's signature", () => {
    expect(verifyPaddleSignature(body, signPaddleBody(body, SECRET, now), SECRET, now)).toBe(true);
  });
  it("refuses another secret, a changed body, a missing or malformed header", () => {
    const header = signPaddleBody(body, SECRET, now);
    expect(verifyPaddleSignature(body, header, "pdl_ntfset_other", now)).toBe(false);
    expect(verifyPaddleSignature(body.replace("evt_1", "evt_2"), header, SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, null, SECRET, now)).toBe(false);
    expect(verifyPaddleSignature(body, "garbage", SECRET, now)).toBe(false);
  });
  it("refuses an old signature (a replay)", () => {
    const header = signPaddleBody(body, SECRET, new Date(now.getTime() - 10 * 60 * 1000));
    expect(verifyPaddleSignature(body, header, SECRET, now)).toBe(false);
  });
  it("accepts any of the signatures sent while a secret is rotated", () => {
    const [ts, h1] = signPaddleBody(body, SECRET, now).split(";");
    expect(verifyPaddleSignature(body, `${ts};h1=${"0".repeat(64)};${h1}`, SECRET, now)).toBe(true);
  });
});

describe("plan prices sent to Paddle", () => {
  const plan = { key: "growth", name: { en: "Growth", ar: "النمو" }, price_minor: 14900, currency: "USD", billing_interval: "month" as const };
  it("bills the plan's own price every month, carrying its plan", () => {
    const item = checkoutItem(plan);
    expect(item.quantity).toBe(1);
    expect(item.price).toMatchObject({
      unitPrice: { amount: "14900", currencyCode: "USD" },
      billingCycle: { interval: "month", frequency: 1 },
      customData: { plan_key: "growth" },
      product: { name: "SmartManager AI Agent — Growth" },
    });
    expect(planChangeItem({ ...plan, billing_interval: "year" }).price).toMatchObject({ billingCycle: { interval: "year", frequency: 1 } });
  });
  it("knows the currencies Paddle accepts", () => {
    expect(PADDLE_CURRENCIES.has("USD")).toBe(true);
    expect(PADDLE_CURRENCIES.has("QAR")).toBe(false);
  });
});

// Event bodies in Paddle's own (snake_case) shape.
const price = (planKey: string, amount: string) => ({
  id: "pri_01",
  product_id: "pro_01",
  description: "SmartManager AI Agent — Growth (monthly)",
  name: "Growth",
  type: "custom",
  billing_cycle: { interval: "month", frequency: 1 },
  trial_period: null,
  tax_mode: "account_setting",
  unit_price: { amount, currency_code: "USD" },
  unit_price_overrides: [],
  quantity: { minimum: 1, maximum: 1 },
  status: "active",
  created_at: "2026-10-04T12:00:00Z",
  updated_at: "2026-10-04T12:00:00Z",
  custom_data: { plan_key: planKey },
  import_meta: null,
});
const totals = (subtotal: string, tax: string) => ({
  subtotal,
  discount: "0",
  tax,
  total: String(Number(subtotal) + Number(tax)),
  credit: "0",
  credit_to_balance: "0",
  balance: "0",
  grand_total: String(Number(subtotal) + Number(tax)),
  fee: null,
  earnings: null,
  currency_code: "USD",
});
const transaction = (origin: string, subtotal: string) => ({
  event_id: `evt_${origin}`,
  event_type: "transaction.completed",
  occurred_at: "2026-10-04T12:00:05Z",
  notification_id: "ntf_1",
  data: {
    id: `txn_${origin}`,
    status: "completed",
    customer_id: "ctm_1",
    address_id: "add_1",
    business_id: null,
    custom_data: { tenant_id: "t1", plan_key: "growth" },
    currency_code: "USD",
    origin,
    subscription_id: "sub_1",
    invoice_id: null,
    invoice_number: null,
    collection_mode: "automatic",
    discount_id: null,
    billing_details: null,
    billing_period: { starts_at: "2026-10-04T12:00:00Z", ends_at: "2026-11-04T12:00:00Z" },
    items: [{ price: price("growth", "14900"), quantity: 1, proration: null }],
    details: { tax_rates_used: [], totals: totals(subtotal, "2980"), adjusted_totals: null, payout_totals: null, adjusted_payout_totals: null, line_items: [] },
    payments: [],
    checkout: { url: "https://ai-agent.smartmanager.me/checkout?_ptxn=txn_web" },
    created_at: "2026-10-04T12:00:00Z",
    updated_at: "2026-10-04T12:00:05Z",
    billed_at: "2026-10-04T12:00:05Z",
    revised_at: null,
  },
});
const subscription = (eventType: string, status: string, scheduledChange: unknown = null) => ({
  event_id: `evt_${eventType}`,
  event_type: eventType,
  occurred_at: "2026-10-10T08:00:00Z",
  notification_id: "ntf_2",
  data: {
    id: "sub_1",
    status,
    transaction_id: "txn_web",
    customer_id: "ctm_1",
    address_id: "add_1",
    business_id: null,
    currency_code: "USD",
    created_at: "2026-10-04T12:00:00Z",
    updated_at: "2026-10-10T08:00:00Z",
    started_at: "2026-10-04T12:00:00Z",
    first_billed_at: "2026-10-04T12:00:00Z",
    next_billed_at: "2026-11-04T12:00:00Z",
    paused_at: null,
    canceled_at: null,
    discount: null,
    collection_mode: "automatic",
    billing_details: null,
    current_billing_period: { starts_at: "2026-10-04T12:00:00Z", ends_at: "2026-11-04T12:00:00Z" },
    billing_cycle: { interval: "month", frequency: 1 },
    scheduled_change: scheduledChange,
    items: [
      {
        status: "active",
        quantity: 1,
        recurring: true,
        created_at: "2026-10-04T12:00:00Z",
        updated_at: "2026-10-04T12:00:00Z",
        previously_billed_at: null,
        next_billed_at: "2026-11-04T12:00:00Z",
        trial_dates: null,
        price: price("pro", "24900"),
        product: null,
      },
    ],
    custom_data: { tenant_id: "t1", plan_key: "pro" },
    import_meta: null,
  },
});

describe("what a Paddle event means", () => {
  it("the subscriber's checkout: the plan price must match the checkout's", () => {
    const action = paddleAction(Webhooks.fromJson(transaction("web", "14900") as never));
    expect(action).toMatchObject({
      kind: "payment",
      transactionId: "txn_web",
      subscriptionId: "sub_1",
      customerId: "ctm_1",
      planKey: "growth",
      amountMinor: 14900,
      currency: "USD",
      checkAmount: 14900,
      periodEnd: "2026-11-04T12:00:00Z",
    });
  });
  it("a renewal: recorded at the plan price, nothing to compare", () => {
    expect(paddleAction(Webhooks.fromJson(transaction("subscription_recurring", "14900") as never))).toMatchObject({
      kind: "payment",
      amountMinor: 14900,
      checkAmount: null,
    });
  });
  it("a plan change: recorded at what was charged pro rata (before tax)", () => {
    expect(paddleAction(Webhooks.fromJson(transaction("subscription_update", "6667") as never))).toMatchObject({
      kind: "payment",
      amountMinor: 6667,
      checkAmount: null,
    });
  });
  it("a scheduled cancellation, with the plan the subscription is on", () => {
    const action = paddleAction(
      Webhooks.fromJson(subscription("subscription.updated", "active", { action: "cancel", effective_at: "2026-11-04T12:00:00Z", resume_at: null }) as never),
    );
    expect(action).toMatchObject({ kind: "subscription", status: "active", cancelAt: "2026-11-04T12:00:00Z", planKey: "pro", transactionId: null });
  });
  it("a new subscription names the checkout that created it", () => {
    expect(paddleAction(Webhooks.fromJson(subscription("subscription.created", "active") as never))).toMatchObject({
      kind: "subscription",
      transactionId: "txn_web",
      subscriptionId: "sub_1",
    });
  });
  it("past due and cancelled", () => {
    expect(paddleAction(Webhooks.fromJson(subscription("subscription.past_due", "past_due") as never))).toMatchObject({ status: "past_due" });
    expect(paddleAction(Webhooks.fromJson(subscription("subscription.canceled", "canceled") as never))).toMatchObject({ status: "canceled", cancelAt: null });
  });
  it("other events change nothing", () => {
    expect(paddleAction(Webhooks.fromJson({ event_id: "e", event_type: "customer.created", occurred_at: "2026-10-04T12:00:00Z", notification_id: "n", data: {} } as never)).kind).toBe(
      "ignore",
    );
  });
});
