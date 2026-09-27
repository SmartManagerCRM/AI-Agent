import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CreateIntentInput,
  PaymentCredentials,
  PaymentIntent,
  PaymentProvider,
  PaymentProviderResult,
  PaymentVerification,
} from "./provider";

/**
 * Tap Payments — a MENA payment gateway (cards, mada, KNET, Benefit, Apple
 * Pay, Google Pay). Uses the **Charges API** (`POST /v2/charges`) with
 * `source.id: "src_all"`, which tells Tap to show every payment method
 * enabled on the merchant account on its own hosted page (`transaction.url`
 * in the response) — the same reasoning as Moyasar's Invoice API: Apple Pay
 * needs no separate code path here, it's just one more button on Tap's own
 * checkout page once enabled on the account and the domain is verified
 * (see DEPLOYMENT.md).
 *
 * Tap's amounts are **decimal major units** (e.g. `12.500` for 3-decimal
 * currencies like KWD), unlike Moyasar's minor units — `currencyExponent`
 * (from `CreateIntentInput`/the verify `context`) is what converts between
 * this app's internal bigint-minor-unit representation and Tap's own.
 *
 * ⚠ This session's network egress could not reach developers.tap.company
 * to do a final byte-for-byte confirmation of the webhook signature
 * algorithm (blocked by this environment's proxy — see DEPLOYMENT.md).
 * The Charges API request/response shape (`source.id`, `transaction.url`)
 * is corroborated from multiple independent sources; the exact webhook
 * hash recipe is this module's one remaining soft spot. What's implemented
 * here — HMAC-SHA256 of the raw JSON body, hex-encoded, compared against
 * the `hashstring` header — is the simplest and most commonly documented
 * shape, but Tap's real recipe may instead hash a specific concatenation
 * of individual fields (some sources describe this). Verify against a real
 * sandbox delivery before trusting this with live traffic, and adjust
 * `computeHash` below if the real payload differs.
 */
const TAP_API_BASE = "https://api.tap.company/v2";

type TapChargeResponse = { id: string; status: string; transaction?: { url?: string } };

type TapWebhookPayload = {
  id?: string;
  status?: string;
  amount?: number;
  currency?: string;
  response?: { code?: string; message?: string };
};

const SUCCESS_STATUSES = new Set(["CAPTURED", "PAID"]);
const FAILURE_STATUSES = new Set(["FAILED", "DECLINED", "CANCELLED", "VOID", "RESTRICTED"]);

function toMajorUnits(amountMinor: number, exponent: number): string {
  return (amountMinor / 10 ** exponent).toFixed(exponent);
}

function toMinorUnits(amountMajor: number, exponent: number): number {
  return Math.round(amountMajor * 10 ** exponent);
}

function computeHash(rawBody: string, secretKey: string): string {
  return createHmac("sha256", secretKey).update(rawBody).digest("hex");
}

export const tapProvider: PaymentProvider = {
  name: "tap",
  webhookSignatureHeader: "hashstring",

  configured(credentials: PaymentCredentials): boolean {
    return typeof credentials.tapSecretKey === "string" && credentials.tapSecretKey.length > 0;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    const secretKey = credentials.tapSecretKey;
    if (!secretKey) return { ok: false, error: "Tap isn't set up yet for this business." };

    let response: Response;
    try {
      response = await fetch(`${TAP_API_BASE}/charges`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secretKey}` },
        body: JSON.stringify({
          amount: Number(toMajorUnits(input.amountMinor, input.currencyExponent)),
          currency: input.currency,
          customer: { first_name: "Guest" },
          source: { id: "src_all" },
          redirect: { url: input.callbackUrl },
          description: `Order #${input.orderNumber}`,
          reference: { order: String(input.orderNumber) },
          metadata: { payment_id: input.paymentId },
        }),
      });
    } catch {
      return { ok: false, error: "Could not reach Tap." };
    }

    if (!response.ok) {
      return { ok: false, error: `Tap rejected the payment request (${response.status}).` };
    }

    const charge = (await response.json()) as TapChargeResponse;
    if (!charge.id || !charge.transaction?.url) {
      return { ok: false, error: "Tap returned an unexpected response." };
    }

    return { ok: true, value: { provider: "tap", providerIntentId: charge.id, checkoutUrl: charge.transaction.url } };
  },

  extractProviderIntentId(rawBody: string): string | null {
    const payload = parseBody(rawBody);
    return payload?.id ?? null;
  },

  verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
    credentials: PaymentCredentials,
    context: { currencyExponent: number },
  ): PaymentVerification | null {
    const secretKey = credentials.tapSecretKey;
    if (!secretKey || !signatureHeader) return null;

    const expected = computeHash(rawBody, secretKey);
    if (!constantTimeStringEqual(expected, signatureHeader.toLowerCase())) return null;

    const payload = parseBody(rawBody);
    if (!payload?.id || !payload.status) return null;

    const amountMinor = typeof payload.amount === "number" ? toMinorUnits(payload.amount, context.currencyExponent) : 0;

    if (SUCCESS_STATUSES.has(payload.status)) {
      return {
        providerIntentId: payload.id,
        providerEventId: payload.id,
        status: "succeeded",
        amountMinor,
        currency: payload.currency ?? "",
      };
    }
    if (FAILURE_STATUSES.has(payload.status)) {
      return {
        providerIntentId: payload.id,
        providerEventId: payload.id,
        status: "failed",
        amountMinor,
        currency: payload.currency ?? "",
        failureReason: payload.response?.message,
      };
    }
    // A validly-signed event we don't act on yet (e.g. INITIATED) — not a
    // forged delivery, just not a terminal outcome.
    return null;
  },
};

function parseBody(rawBody: string): TapWebhookPayload | null {
  try {
    return JSON.parse(rawBody) as TapWebhookPayload;
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
