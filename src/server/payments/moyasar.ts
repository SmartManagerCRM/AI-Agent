import { timingSafeEqual } from "node:crypto";

import type {
  CreateIntentInput,
  PaymentCredentials,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderResult,
  PaymentVerification,
} from "./provider";

/**
 * Moyasar — a Saudi payment gateway (mada, Visa/Mastercard/Amex, Apple Pay,
 * STC Pay). Uses the **Invoice API** (`POST /v1/invoices`), not the Payment
 * API directly: an invoice is a Moyasar-hosted checkout page (its own `url`
 * field is exactly this app's `checkoutUrl` shape), so the customer is
 * redirected there and never enters card details on our own page — the
 * same zero-PCI-scope shape the mock provider already established. Apple
 * Pay needs no separate code path here at all: it's a payment method
 * Moyasar's own hosted page offers automatically once enabled on the
 * merchant account and the domain is Apple-verified (see DEPLOYMENT.md).
 *
 * Credentials are per-tenant (`src/server/payments/service.ts` loads them
 * from `tenant_payment_config` before calling any method here) —
 * `credentials.moyasarSecretKey` authenticates API calls (HTTP Basic Auth,
 * the secret key as username, empty password, Moyasar's own convention)
 * and, separately, is compared against the `secret_token` Moyasar echoes
 * back in every webhook body to prove the delivery is really theirs.
 *
 * ⚠ This session's network egress could not reach docs.moyasar.com to do a
 * final byte-for-byte confirmation of the webhook payload shape (blocked
 * by this environment's proxy — see DEPLOYMENT.md). The Invoice API request
 * fields and response shape (`id`, `status`, `url`) are corroborated from
 * multiple independent sources; the webhook's exact nesting (`data.id` vs
 * `data.invoice_id`) is this module's one remaining soft spot — verify
 * against a real sandbox delivery before trusting this with live traffic,
 * and adjust `extractProviderIntentId`/`verifyWebhook` if the real payload
 * differs.
 */
const MOYASAR_API_BASE = "https://api.moyasar.com/v1";

type MoyasarInvoiceResponse = { id: string; status: string; url: string };

type MoyasarWebhookPayload = {
  id?: string;
  type?: string;
  secret_token?: string;
  data?: {
    id?: string;
    invoice_id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    source?: { message?: string };
  };
};

const SUCCESS_TYPES = new Set(["payment_paid", "payment_captured"]);
const FAILURE_TYPES = new Set(["payment_failed", "payment_voided", "payment_abandoned"]);

function basicAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

export const moyasarProvider: PaymentProvider = {
  name: "moyasar",
  webhookSignatureHeader: "x-moyasar-signature",

  configured(credentials: PaymentCredentials): boolean {
    return typeof credentials.moyasarSecretKey === "string" && credentials.moyasarSecretKey.length > 0;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    const secretKey = credentials.moyasarSecretKey;
    if (!secretKey) return { ok: false, error: "Moyasar isn't set up yet for this business." };

    let response: Response;
    try {
      response = await fetch(`${MOYASAR_API_BASE}/invoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: basicAuthHeader(secretKey) },
        body: JSON.stringify({
          amount: input.amountMinor,
          currency: input.currency,
          description: `Order #${input.orderNumber}`,
          callback_url: input.callbackUrl,
          metadata: { payment_id: input.paymentId },
        }),
      });
    } catch {
      return { ok: false, error: "Could not reach Moyasar." };
    }

    if (!response.ok) {
      return { ok: false, error: `Moyasar rejected the payment request (${response.status}).` };
    }

    const invoice = (await response.json()) as MoyasarInvoiceResponse;
    if (!invoice.id || !invoice.url) {
      return { ok: false, error: "Moyasar returned an unexpected response." };
    }

    return { ok: true, value: { provider: "moyasar", providerIntentId: invoice.id, checkoutUrl: invoice.url } };
  },

  extractProviderIntentId(rawBody: string): string | null {
    const payload = parseBody(rawBody);
    if (!payload) return null;
    // The invoice id is what we recorded as provider_intent_id when
    // createIntent ran — Moyasar's webhook nests the underlying payment
    // under `data`, referencing the invoice via `data.invoice_id`.
    return payload.data?.invoice_id ?? payload.data?.id ?? payload.id ?? null;
  },

  verifyWebhook(rawBody: string, _signatureHeader: string | null, credentials: PaymentCredentials): PaymentVerification | null {
    const secretKey = credentials.moyasarSecretKey;
    if (!secretKey) return null;

    const payload = parseBody(rawBody);
    if (!payload || typeof payload.secret_token !== "string") return null;

    if (!constantTimeStringEqual(payload.secret_token, secretKey)) return null;

    const type = payload.type ?? "";
    const data = payload.data;
    if (!data?.id) return null;

    if (SUCCESS_TYPES.has(type)) {
      return {
        providerIntentId: data.invoice_id ?? data.id,
        providerEventId: payload.id ?? data.id,
        status: "succeeded",
        amountMinor: data.amount ?? 0,
        currency: data.currency ?? "",
      };
    }
    if (FAILURE_TYPES.has(type)) {
      return {
        providerIntentId: data.invoice_id ?? data.id,
        providerEventId: payload.id ?? data.id,
        status: "failed",
        amountMinor: data.amount ?? 0,
        currency: data.currency ?? "",
        failureReason: data.source?.message,
      };
    }
    // A validly-signed event we don't act on yet (e.g. payment_authorized,
    // not yet captured) — not a forged delivery, just not a terminal
    // outcome; the caller should treat null uniformly as "nothing to do".
    return null;
  },
};

function parseBody(rawBody: string): MoyasarWebhookPayload | null {
  try {
    return JSON.parse(rawBody) as MoyasarWebhookPayload;
  } catch {
    return null;
  }
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
