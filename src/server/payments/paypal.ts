import { PAYPAL_CURRENCIES } from "@/lib/payments/offered";

import { callProvider, parseJson, toMajorUnits, toMinorUnits } from "./amounts";
import type {
  CreateIntentInput,
  PaymentContext,
  PaymentCredentials,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderResult,
  PaymentVerification,
} from "./provider";

/**
 * PayPal — PayPal balance, cards and the other methods PayPal offers the
 * buyer, through the **Orders v2 API** with the business's own REST app
 * (client id + secret; sandbox or live).
 *
 *   1. An order is created (`intent: CAPTURE`) and the customer is sent to
 *      PayPal's approval page (the `payer-action` link).
 *   2. Approving does not move money yet: the order must be **captured**.
 *      That happens when the customer comes back (the return page asks
 *      `syncStatus`), or when PayPal's `CHECKOUT.ORDER.APPROVED` webhook
 *      arrives first — whichever comes first; the capture carries a
 *      `PayPal-Request-Id`, so it is never done twice.
 *   3. The order is paid when its capture is `COMPLETED`.
 *
 * Webhook bodies are never trusted: the order id they name is only used to
 * find our payment, and the outcome is always read back from PayPal's API
 * with that business's own credentials (no signature to check by hand).
 * Access tokens are fetched per call — never cached across businesses.
 *
 * PayPal accepts a limited set of currencies (not SAR, AED, KWD, QAR, …):
 * businesses pricing in those can't use it, and are told so.
 */
const PAYPAL_LIVE = "https://api-m.paypal.com";
const PAYPAL_SANDBOX = "https://api-m.sandbox.paypal.com";


type PayPalLink = { href?: string; rel?: string };
type PayPalAmount = { currency_code?: string; value?: string };
type PayPalCapture = { id?: string; status?: string; amount?: PayPalAmount; status_details?: { reason?: string } };
type PayPalOrder = {
  id?: string;
  status?: string;
  links?: PayPalLink[];
  purchase_units?: { custom_id?: string; payments?: { captures?: PayPalCapture[] } }[];
};
type PayPalEvent = {
  event_type?: string;
  resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } };
};

const baseUrl = (credentials: PaymentCredentials) => (credentials.paypalTestMode ? PAYPAL_SANDBOX : PAYPAL_LIVE);

async function accessToken(credentials: PaymentCredentials): Promise<string | null> {
  const { paypalClientId: id, paypalClientSecret: secret } = credentials;
  if (!id || !secret) return null;
  const result = await callProvider(`${baseUrl(credentials)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const token = (result?.json as { access_token?: unknown } | null)?.access_token;
  return result?.ok && typeof token === "string" ? token : null;
}

/** An order's outcome from its capture: COMPLETED → succeeded, DECLINED/FAILED → failed, otherwise not final yet. */
export function paypalOrderOutcome(order: PayPalOrder, exponent: number): PaymentVerification | null {
  if (!order.id) return null;
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (order.status === "VOIDED") {
    return { providerIntentId: order.id, providerEventId: `paypal:${order.id}:voided`, status: "failed", amountMinor: 0, currency: "", failureReason: "order voided" };
  }
  if (!capture?.id || !capture.status) return null;
  const amountMinor = toMinorUnits(capture.amount?.value, exponent) ?? 0;
  const currency = capture.amount?.currency_code ?? "";
  if (capture.status === "COMPLETED") {
    return { providerIntentId: order.id, providerEventId: `paypal:${capture.id}:completed`, status: "succeeded", amountMinor, currency };
  }
  if (capture.status === "DECLINED" || capture.status === "FAILED") {
    return {
      providerIntentId: order.id,
      providerEventId: `paypal:${capture.id}:${capture.status.toLowerCase()}`,
      status: "failed",
      amountMinor,
      currency,
      failureReason: capture.status_details?.reason ?? capture.status,
    };
  }
  return null;
}

async function syncOrder(orderId: string, credentials: PaymentCredentials, context: PaymentContext): Promise<PaymentVerification | null> {
  if (!/^[A-Z0-9]{5,40}$/.test(orderId)) return null;
  const token = await accessToken(credentials);
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const got = await callProvider(`${baseUrl(credentials)}/v2/checkout/orders/${orderId}`, { method: "GET", headers });
  if (!got?.ok) return null;
  let order = got.json as PayPalOrder;
  if (order?.id !== orderId) return null;
  // Our own order (we set custom_id to our payment id when creating it).
  const customId = order.purchase_units?.[0]?.custom_id;
  if (context.paymentId && customId && customId !== context.paymentId) return null;

  if (order.status === "APPROVED") {
    const captured = await callProvider(`${baseUrl(credentials)}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: { ...headers, "PayPal-Request-Id": `capture-${context.paymentId ?? orderId}` },
      body: "{}",
    });
    if (captured?.ok) {
      order = captured.json as PayPalOrder;
    } else {
      // Already captured elsewhere (the webhook and the return page racing), or declined: read the order again.
      const again = await callProvider(`${baseUrl(credentials)}/v2/checkout/orders/${orderId}`, { method: "GET", headers });
      if (!again?.ok) return null;
      order = again.json as PayPalOrder;
    }
  }
  return paypalOrderOutcome(order, context.currencyExponent);
}

export const paypalProvider: PaymentProvider = {
  name: "paypal",
  webhookSignatureHeader: "paypal-transmission-sig",

  configured(credentials: PaymentCredentials): boolean {
    return !!credentials.paypalClientId && !!credentials.paypalClientSecret;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    if (!PAYPAL_CURRENCIES.has(input.currency)) return { ok: false, error: `PayPal doesn't accept payments in ${input.currency}.` };
    const token = await accessToken(credentials);
    if (!token) return { ok: false, error: "Could not sign in to PayPal with this business's credentials." };

    const result = await callProvider(`${baseUrl(credentials)}/v2/checkout/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": `order-${input.paymentId}` },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: input.paymentId,
            custom_id: input.paymentId,
            description: `Order #${input.orderNumber}`,
            amount: { currency_code: input.currency, value: toMajorUnits(input.amountMinor, input.currencyExponent) },
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              return_url: input.callbackUrl,
              cancel_url: input.callbackUrl,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
            },
          },
        },
      }),
    });
    if (!result) return { ok: false, error: "Could not reach PayPal." };
    if (!result.ok) return { ok: false, error: `PayPal rejected the payment request (${result.status}).` };
    const order = result.json as PayPalOrder;
    const approve = order?.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
    if (!order?.id || !approve) return { ok: false, error: "PayPal returned an unexpected response." };
    return { ok: true, value: { provider: "paypal", providerIntentId: order.id, checkoutUrl: approve } };
  },

  extractProviderIntentId(rawBody: string): string | null {
    const event = parseJson<PayPalEvent>(rawBody);
    const type = event?.event_type ?? "";
    if (type.startsWith("CHECKOUT.ORDER.")) return event?.resource?.id ?? null;
    if (type.startsWith("PAYMENT.CAPTURE.")) return event?.resource?.supplementary_data?.related_ids?.order_id ?? null;
    return null;
  },

  // The body only names the order; its outcome is read back from PayPal itself.
  async verifyWebhook(rawBody, _signatureHeader, credentials, context) {
    const orderId = paypalProvider.extractProviderIntentId(rawBody);
    return orderId ? syncOrder(orderId, credentials, context) : null;
  },

  syncStatus(providerIntentId, credentials, context) {
    return syncOrder(providerIntentId, credentials, context);
  },
};
