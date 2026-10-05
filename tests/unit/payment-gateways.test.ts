import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { offeredPaymentMethods } from "@/lib/payments/offered";
import { classifyHyperpayCode, hyperpayAmount, hyperpayProvider, parseHyperpayIntent } from "@/server/payments/hyperpay";
import { myFatoorahOutcome, myfatoorahProvider, normalizeMyFatoorahCurrency } from "@/server/payments/myfatoorah";
import { paypalOrderOutcome, paypalProvider } from "@/server/payments/paypal";
import { stripeProvider, verifyStripeSignature } from "@/server/payments/stripe";

const input = {
  paymentId: "11111111-2222-4333-8444-555555555555",
  orderNumber: 1042,
  amountMinor: 12_500,
  currency: "USD",
  currencyExponent: 2,
  callbackUrl: "https://agent.example.com/pay/11111111-2222-4333-8444-555555555555",
};

type Call = { url: string; init: RequestInit };
function stubFetch(responses: ((call: Call) => { status?: number; body: unknown })[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const call = { url, init };
      calls.push(call);
      const next = responses.shift();
      if (!next) throw new Error(`unexpected request ${url}`);
      const { status = 200, body } = next(call);
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("Stripe", () => {
  const secret = "whsec_test_secret";
  const sign = (body: string, t: number, key = secret) => `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;
  const now = 1_790_000_000;
  const session = { id: "cs_test_abc", object: "checkout.session", payment_status: "paid", status: "complete", amount_total: 12_500, currency: "usd" };

  it("verifies Stripe-Signature: right secret and fresh only", () => {
    const body = JSON.stringify({ id: "evt_1" });
    expect(verifyStripeSignature(body, sign(body, now), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${now},v1=deadbeef,${sign(body, now).split(",")[1]}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, sign(body, now, "whsec_other"), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 301), secret, now)).toBe(false);
    expect(verifyStripeSignature(`${body} `, sign(body, now), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });

  it("maps checkout events to outcomes (signed with the business's secret)", () => {
    const t = Math.floor(Date.now() / 1000);
    const event = (type: string, object: object) => {
      const body = JSON.stringify({ id: `evt_${type}`, type, data: { object } });
      return stripeProvider.verifyWebhook(body, sign(body, t), { stripeWebhookSecret: secret }, { currencyExponent: 2 });
    };
    expect(event("checkout.session.completed", session)).toMatchObject({ status: "succeeded", providerIntentId: "cs_test_abc", amountMinor: 12_500, currency: "USD" });
    expect(event("checkout.session.completed", { ...session, payment_status: "unpaid" })).toBeNull();
    expect(event("checkout.session.async_payment_failed", { ...session, payment_status: "unpaid" })).toMatchObject({ status: "failed" });
    expect(event("checkout.session.expired", { ...session, payment_status: "unpaid", status: "expired" })).toMatchObject({ status: "failed" });
    expect(stripeProvider.extractProviderIntentId(JSON.stringify({ data: { object: session } }))).toBe("cs_test_abc");
    // No signing secret saved: a webhook can't be verified (the return page still confirms payments).
    const body = JSON.stringify({ id: "evt", type: "checkout.session.completed", data: { object: session } });
    expect(stripeProvider.verifyWebhook(body, sign(body, t), {}, { currencyExponent: 2 })).toBeNull();
  });

  it("creates a Checkout Session for the exact amount, tied to the payment", async () => {
    const calls = stubFetch([() => ({ body: { id: "cs_test_abc", url: "https://checkout.stripe.com/c/pay/cs_test_abc" } })]);
    const result = await stripeProvider.createIntent(input, { stripeSecretKey: "sk_test_123" });
    expect(result).toEqual({ ok: true, value: { provider: "stripe", providerIntentId: "cs_test_abc", checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc" } });
    expect(calls[0].url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk_test_123");
    expect(headers["Idempotency-Key"]).toBe(`checkout-${input.paymentId}`);
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("12500");
    expect(form.get("line_items[0][price_data][currency]")).toBe("usd");
    expect(form.get("metadata[payment_id]")).toBe(input.paymentId);
    expect(form.get("success_url")).toBe(input.callbackUrl);
  });

  it("asks Stripe for the session when the customer returns", async () => {
    stubFetch([() => ({ body: session })]);
    expect(await stripeProvider.syncStatus!("cs_test_abc", { stripeSecretKey: "sk_test_123" }, { currencyExponent: 2 })).toMatchObject({ status: "succeeded", amountMinor: 12_500 });
    stubFetch([() => ({ body: { ...session, payment_status: "unpaid", status: "open" } })]);
    expect(await stripeProvider.syncStatus!("cs_test_abc", { stripeSecretKey: "sk_test_123" }, { currencyExponent: 2 })).toBeNull();
    expect(await stripeProvider.syncStatus!("../evil", { stripeSecretKey: "sk_test_123" }, { currencyExponent: 2 })).toBeNull();
  });
});

describe("PayPal", () => {
  const credentials = { paypalClientId: "client", paypalClientSecret: "secret", paypalTestMode: true };
  const completedOrder = {
    id: "5O190127TN364715T",
    status: "COMPLETED",
    purchase_units: [{ custom_id: input.paymentId, payments: { captures: [{ id: "3C679366HH908993F", status: "COMPLETED", amount: { currency_code: "USD", value: "125.00" } }] } }],
  };

  it("maps an order's capture to an outcome", () => {
    expect(paypalOrderOutcome(completedOrder, 2)).toMatchObject({ status: "succeeded", amountMinor: 12_500, currency: "USD" });
    const declined = { ...completedOrder, purchase_units: [{ payments: { captures: [{ id: "C1", status: "DECLINED", amount: { currency_code: "USD", value: "125.00" } }] } }] };
    expect(paypalOrderOutcome(declined, 2)).toMatchObject({ status: "failed" });
    expect(paypalOrderOutcome({ id: "X", status: "APPROVED" }, 2)).toBeNull();
    expect(paypalOrderOutcome({ id: "X", status: "VOIDED" }, 2)).toMatchObject({ status: "failed" });
  });

  it("refuses currencies PayPal doesn't take", async () => {
    expect(await paypalProvider.createIntent({ ...input, currency: "SAR" }, credentials)).toEqual({ ok: false, error: "PayPal doesn't accept payments in SAR." });
  });

  it("creates an order for the exact amount and sends the customer to approve it", async () => {
    const calls = stubFetch([
      () => ({ body: { access_token: "A21AA" } }),
      () => ({ status: 201, body: { id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }] } }),
    ]);
    const result = await paypalProvider.createIntent(input, credentials);
    expect(result).toMatchObject({ ok: true, value: { providerIntentId: "5O190127TN364715T", checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" } });
    expect(calls[0].url).toBe("https://api-m.sandbox.paypal.com/v1/oauth2/token");
    const body = JSON.parse(String(calls[1].init.body));
    expect(body.intent).toBe("CAPTURE");
    expect(body.purchase_units[0]).toMatchObject({ custom_id: input.paymentId, amount: { currency_code: "USD", value: "125.00" } });
    expect(body.payment_source.paypal.experience_context.return_url).toBe(input.callbackUrl);
  });

  it("captures an approved order when the customer returns, once", async () => {
    const calls = stubFetch([
      () => ({ body: { access_token: "A21AA" } }),
      () => ({ body: { id: "5O190127TN364715T", status: "APPROVED", purchase_units: [{ custom_id: input.paymentId }] } }),
      () => ({ status: 201, body: completedOrder }),
    ]);
    const outcome = await paypalProvider.syncStatus!("5O190127TN364715T", credentials, { currencyExponent: 2, paymentId: input.paymentId });
    expect(outcome).toMatchObject({ status: "succeeded", amountMinor: 12_500 });
    expect(calls[2].url).toBe("https://api-m.sandbox.paypal.com/v2/checkout/orders/5O190127TN364715T/capture");
    expect((calls[2].init.headers as Record<string, string>)["PayPal-Request-Id"]).toBe(`capture-${input.paymentId}`);
  });

  it("never trusts a webhook body: it only names the order, read back from PayPal", async () => {
    expect(paypalProvider.extractProviderIntentId(JSON.stringify({ event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: "ORDER1" } }))).toBe("ORDER1");
    expect(
      paypalProvider.extractProviderIntentId(JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { id: "CAP", supplementary_data: { related_ids: { order_id: "ORDER2" } } } })),
    ).toBe("ORDER2");
    // Someone else's order (custom_id isn't this payment): no outcome.
    stubFetch([
      () => ({ body: { access_token: "A21AA" } }),
      () => ({ body: { ...completedOrder, purchase_units: [{ ...completedOrder.purchase_units[0], custom_id: "another-payment" }] } }),
    ]);
    const forged = JSON.stringify({ event_type: "PAYMENT.CAPTURE.COMPLETED", resource: { supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } } } });
    expect(await paypalProvider.verifyWebhook(forged, null, credentials, { currencyExponent: 2, paymentId: input.paymentId })).toBeNull();
  });
});

describe("MyFatoorah", () => {
  const ctx = { currencyExponent: 3, paymentId: input.paymentId, orderCurrency: "KWD", accountCountry: "KWT" };
  const paid = {
    InvoiceId: 4_129_101,
    InvoiceStatus: "Paid",
    InvoiceValue: 12.5,
    CustomerReference: input.paymentId,
    InvoiceTransactions: [
      { TransactionStatus: "Failed", PaidCurrency: "KD", PaidCurrencyValue: "12.500", PaymentId: "1" },
      { TransactionStatus: "Succss", PaidCurrency: "KD", PaidCurrencyValue: "12.500", PaymentId: "2" },
    ],
  };

  it("reads the outcome from GetPaymentStatus", () => {
    expect(myFatoorahOutcome(paid, ctx)).toMatchObject({ status: "succeeded", providerIntentId: "4129101", amountMinor: 12_500, currency: "KWD" });
    expect(myFatoorahOutcome({ ...paid, InvoiceStatus: "Pending" }, ctx)).toBeNull();
    expect(myFatoorahOutcome({ ...paid, InvoiceStatus: "Canceled", InvoiceTransactions: [] }, ctx)).toMatchObject({ status: "failed" });
    // Not our invoice.
    expect(myFatoorahOutcome({ ...paid, CustomerReference: "someone-else" }, ctx)).toBeNull();
  });

  it("uses the amount in the order's currency, or none (then refused, never guessed)", () => {
    const paidInUsd = { ...paid, InvoiceTransactions: [{ TransactionStatus: "SUCCESS", PaidCurrency: "USD", PaidCurrencyValue: "40.75" }] };
    // Paid in another currency, but the account's base currency is the order's: the invoice value.
    expect(myFatoorahOutcome(paidInUsd, ctx)).toMatchObject({ amountMinor: 12_500, currency: "KWD" });
    // Neither matches: no amount — the amount check refuses it.
    expect(myFatoorahOutcome(paidInUsd, { ...ctx, accountCountry: "SAU" })).toMatchObject({ amountMinor: -1 });
    expect(normalizeMyFatoorahCurrency("SR")).toBe("SAR");
  });

  it("creates an invoice on the account's host and finds it from a webhook", async () => {
    const calls = stubFetch([() => ({ body: { IsSuccess: true, Data: { InvoiceId: 4_129_101, InvoiceURL: "https://portal.myfatoorah.com/KWT/ie/0106" } } })]);
    const result = await myfatoorahProvider.createIntent({ ...input, currency: "SAR" }, { myfatoorahApiToken: "tok", myfatoorahCountry: "SAU" });
    expect(result).toMatchObject({ ok: true, value: { providerIntentId: "4129101", checkoutUrl: "https://portal.myfatoorah.com/KWT/ie/0106" } });
    expect(calls[0].url).toBe("https://api-sa.myfatoorah.com/v2/SendPayment");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ InvoiceValue: 125, DisplayCurrencyIso: "SAR", CustomerReference: input.paymentId, CallBackUrl: input.callbackUrl });
    expect(myfatoorahProvider.extractProviderIntentId(JSON.stringify({ Data: { InvoiceId: 4_129_101 } }))).toBe("4129101");
    expect(myfatoorahProvider.extractProviderIntentId(JSON.stringify({ Data: { Invoice: { Id: "77" } } }))).toBe("77");
    // Test accounts use MyFatoorah's test host whatever the country.
    const test = stubFetch([() => ({ body: { IsSuccess: true, Data: { InvoiceId: 1, InvoiceURL: "https://demo.myfatoorah.com/x" } } })]);
    await myfatoorahProvider.createIntent(input, { myfatoorahApiToken: "tok", myfatoorahCountry: "SAU", myfatoorahTestMode: true });
    expect(test[0].url).toBe("https://apitest.myfatoorah.com/v2/SendPayment");
  });
});

describe("HyperPay", () => {
  it("classifies HyperPay result codes", () => {
    expect(classifyHyperpayCode("000.000.000")).toBe("succeeded");
    expect(classifyHyperpayCode("000.100.110")).toBe("succeeded");
    expect(classifyHyperpayCode("000.200.000")).toBe("pending");
    expect(classifyHyperpayCode("200.300.404")).toBe("not_started");
    expect(classifyHyperpayCode("800.100.151")).toBe("failed");
  });

  it("writes amounts with two decimals", () => {
    expect(hyperpayAmount(12_500, 2)).toBe("125.00");
    expect(hyperpayAmount(12_340, 3)).toBe("12.34");
    expect(hyperpayAmount(12_345, 3)).toBeNull();
  });

  it("prepares a checkout per entity (mada first) and reads the result from HyperPay", async () => {
    const credentials = { hyperpayAccessToken: "tok", hyperpayEntityId: "8a8294174b7ecb28014b9699220015ca", hyperpayMadaEntityId: "8a8294174b7ecb28014b9699220015cb", hyperpayTestMode: true };
    const calls = stubFetch([
      () => ({ body: { id: "CHECKOUT.CARDS.1", result: { code: "000.200.100" } } }),
      () => ({ body: { id: "CHECKOUT.MADA.1", result: { code: "000.200.100" } } }),
    ]);
    const result = await hyperpayProvider.createIntent({ ...input, currency: "SAR" }, credentials);
    expect(result).toEqual({ ok: true, value: { provider: "hyperpay", providerIntentId: "mada:CHECKOUT.MADA.1|cards:CHECKOUT.CARDS.1", checkoutUrl: `/pay/${input.paymentId}` } });
    expect(calls[0].url).toBe("https://eu-test.oppwa.com/v1/checkouts");
    const form = new URLSearchParams(String(calls[0].init.body));
    expect(Object.fromEntries(form)).toMatchObject({ entityId: credentials.hyperpayEntityId, amount: "125.00", currency: "SAR", paymentType: "DB", merchantTransactionId: input.paymentId });
    expect(parseHyperpayIntent("mada:CHECKOUT.MADA.1|cards:CHECKOUT.CARDS.1|evil:x")).toEqual([
      { brand: "mada", checkoutId: "CHECKOUT.MADA.1" },
      { brand: "cards", checkoutId: "CHECKOUT.CARDS.1" },
    ]);

    const status = stubFetch([
      () => ({ body: { result: { code: "200.300.404" } } }),
      () => ({ body: { id: "8ac7a4a1", amount: "125.00", currency: "SAR", merchantTransactionId: input.paymentId, result: { code: "000.100.110" } } }),
    ]);
    const outcome = await hyperpayProvider.syncStatus!("mada:CHECKOUT.MADA.1|cards:CHECKOUT.CARDS.1", credentials, { currencyExponent: 2, paymentId: input.paymentId });
    expect(outcome).toMatchObject({ status: "succeeded", amountMinor: 12_500, currency: "SAR" });
    expect(status[0].url).toBe(`https://eu-test.oppwa.com/v1/checkouts/CHECKOUT.MADA.1/payment?entityId=${credentials.hyperpayMadaEntityId}`);
  });
});

describe("Methods offered at checkout", () => {
  it("PayPal only for currencies PayPal accepts", () => {
    expect(offeredPaymentMethods(["stripe", "paypal", "cash_on_delivery"], "SAR")).toEqual(["stripe", "cash_on_delivery"]);
    expect(offeredPaymentMethods(["stripe", "paypal", "cash_on_delivery"], "usd")).toEqual(["stripe", "paypal", "cash_on_delivery"]);
  });
});
