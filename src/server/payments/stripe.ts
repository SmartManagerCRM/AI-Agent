import { createHmac } from "node:crypto";

import { callProvider, constantTimeStringEqual, parseJson } from "./amounts";
import type {
  CreateIntentInput,
  PaymentCredentials,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderResult,
  PaymentVerification,
} from "./provider";

/**
 * Stripe — cards, Apple Pay, Google Pay and the other methods enabled on the
 * business's own Stripe account. Uses **Checkout Sessions**
 * (`POST /v1/checkout/sessions`): a Stripe-hosted page (`url`), so card
 * details never touch this app, like Moyasar's and Tap's hosted pages.
 * Amounts are in the currency's smallest unit, as in this app.
 *
 * A payment is confirmed two ways, both server-side:
 *  - Stripe's webhook (`Stripe-Signature`: HMAC-SHA256 of `{t}.{raw body}`
 *    with the endpoint's signing secret, `whsec_…`, 5-minute tolerance);
 *  - asking Stripe for the session (`GET /v1/checkout/sessions/{id}`) when
 *    the customer comes back — so payments are confirmed even before the
 *    business has set up the webhook.
 */
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const SIGNATURE_TOLERANCE_SECONDS = 300;

type StripeSession = {
  id?: string;
  object?: string;
  url?: string | null;
  status?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
};

type StripeEvent = { id?: string; type?: string; data?: { object?: StripeSession } };

/** Stripe's API takes form-encoded bodies with bracketed keys. */
function formBody(fields: Record<string, string | number>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
}

/** Checks `Stripe-Signature` (`t=…,v1=…[,v1=…]`) against the raw body. */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const [key, value] = part.split("=", 2).map((s) => s?.trim() ?? "");
    if (key === "t") timestamp = Number(value);
    else if (key === "v1" && value) signatures.push(value);
  }
  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return signatures.some((signature) => constantTimeStringEqual(expected, signature));
}

/** A session's outcome: paid → succeeded, expired → failed, anything else is not final yet. */
function sessionOutcome(session: StripeSession, eventId: string, forceFailed = false): PaymentVerification | null {
  if (!session.id) return null;
  const base = { providerIntentId: session.id, providerEventId: eventId, amountMinor: session.amount_total ?? 0, currency: (session.currency ?? "").toUpperCase() };
  if (!forceFailed && session.payment_status === "paid") return { ...base, status: "succeeded" };
  if (forceFailed || session.status === "expired") return { ...base, status: "failed", failureReason: forceFailed ? "payment failed" : "checkout expired" };
  return null;
}

export const stripeProvider: PaymentProvider = {
  name: "stripe",
  webhookSignatureHeader: "stripe-signature",

  configured(credentials: PaymentCredentials): boolean {
    return typeof credentials.stripeSecretKey === "string" && credentials.stripeSecretKey.length > 0;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    const secretKey = credentials.stripeSecretKey;
    if (!secretKey) return { ok: false, error: "Stripe isn't set up yet for this business." };

    const result = await callProvider(`${STRIPE_API_BASE}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        // One session per payment attempt, however often this is retried.
        "Idempotency-Key": `checkout-${input.paymentId}`,
      },
      body: formBody({
        mode: "payment",
        success_url: input.callbackUrl,
        cancel_url: input.callbackUrl,
        client_reference_id: input.paymentId,
        "metadata[payment_id]": input.paymentId,
        "payment_intent_data[metadata][payment_id]": input.paymentId,
        "line_items[0][quantity]": 1,
        "line_items[0][price_data][currency]": input.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": input.amountMinor,
        "line_items[0][price_data][product_data][name]": `Order #${input.orderNumber}`,
      }),
    });
    if (!result) return { ok: false, error: "Could not reach Stripe." };
    if (!result.ok) return { ok: false, error: `Stripe rejected the payment request (${result.status}).` };
    const session = result.json as StripeSession;
    if (!session?.id || !session.url) return { ok: false, error: "Stripe returned an unexpected response." };
    return { ok: true, value: { provider: "stripe", providerIntentId: session.id, checkoutUrl: session.url } };
  },

  extractProviderIntentId(rawBody: string): string | null {
    const event = parseJson<StripeEvent>(rawBody);
    const object = event?.data?.object;
    return object?.object === "checkout.session" && typeof object.id === "string" ? object.id : null;
  },

  verifyWebhook(rawBody: string, signatureHeader: string | null, credentials: PaymentCredentials): PaymentVerification | null {
    const secret = credentials.stripeWebhookSecret;
    if (!secret || !verifyStripeSignature(rawBody, signatureHeader, secret)) return null;
    const event = parseJson<StripeEvent>(rawBody);
    const session = event?.data?.object;
    if (!event?.id || !session) return null;
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return sessionOutcome(session, event.id);
      case "checkout.session.async_payment_failed":
        return sessionOutcome(session, event.id, true);
      case "checkout.session.expired":
        return sessionOutcome({ ...session, status: "expired", payment_status: "unpaid" }, event.id);
      default:
        return null;
    }
  },

  async syncStatus(providerIntentId: string, credentials: PaymentCredentials): Promise<PaymentVerification | null> {
    const secretKey = credentials.stripeSecretKey;
    if (!secretKey || !/^cs_[A-Za-z0-9_]+$/.test(providerIntentId)) return null;
    const result = await callProvider(`${STRIPE_API_BASE}/checkout/sessions/${providerIntentId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!result?.ok) return null;
    const session = result.json as StripeSession;
    if (session?.id !== providerIntentId) return null;
    const outcome = session.payment_status === "paid" ? "paid" : session.status === "expired" ? "expired" : null;
    return outcome ? sessionOutcome(session, `sync:${providerIntentId}:${outcome}`) : null;
  },
};
