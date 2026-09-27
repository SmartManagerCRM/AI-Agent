import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { CreateIntentInput, PaymentIntent, PaymentProvider, PaymentProviderResult, PaymentVerification } from "./provider";

/**
 * The mock payment provider — the MVP's one `PaymentProvider`
 * implementation. There is no real gateway behind it: it stands in for
 * one the way a test double stands in for a dependency that does not
 * exist yet. It still exercises the real thing this whole phase is about
 * — a signed webhook, verified server-side, is the only way a payment can
 * be marked succeeded — it just signs its own webhook instead of a real
 * vendor's.
 *
 * The HMAC secret below is not a deployment credential — the "provider"
 * here *is* our own code, so there is nothing to inject at deploy time.
 * A real provider (Stripe/PayPal) would instead read its webhook signing
 * secret from an env var added at deploy time, exactly like
 * GEMINI_API_KEY/ANTHROPIC_API_KEY (src/server/env-core.ts) — see
 * src/server/payments/service.ts for where that provider would be wired
 * in alongside this one.
 *
 * No `import "server-only"` (same reasoning as src/server/ai/gemini.ts):
 * this module is imported directly by its own unit tests, and the guard
 * only resolves away under Next's `react-server` bundler condition, not
 * under Vitest. Nothing here is reachable from a client bundle regardless.
 */
const MOCK_WEBHOOK_SECRET = "smartmanager-mock-payment-secret-v1";

export type MockWebhookPayload = {
  providerIntentId: string;
  eventId: string;
  status: "succeeded" | "failed";
  amountMinor: number;
  currency: string;
  failureReason?: string;
};

function sign(rawBody: string): string {
  return createHmac("sha256", MOCK_WEBHOOK_SECRET).update(rawBody).digest("hex");
}

/**
 * Builds a correctly-signed webhook body — the way the mock checkout page
 * (src/app/agent/pay/[paymentId]/page.tsx, via its Server Action) asks
 * this "provider" to notify us of an outcome, same as a real vendor would.
 */
export function signMockWebhookPayload(payload: MockWebhookPayload): { body: string; signature: string } {
  const body = JSON.stringify(payload);
  return { body, signature: sign(body) };
}

export const mockPaymentProvider: PaymentProvider = {
  name: "mock",
  webhookSignatureHeader: "x-mock-signature",

  configured(): boolean {
    return true;
  },

  async createIntent(input: CreateIntentInput): Promise<PaymentProviderResult<PaymentIntent>> {
    return {
      ok: true,
      value: {
        provider: "mock",
        providerIntentId: `mock_pi_${randomUUID()}`,
        checkoutUrl: `/pay/${input.paymentId}`,
      },
    };
  },

  extractProviderIntentId(rawBody: string): string | null {
    try {
      const payload = JSON.parse(rawBody) as Partial<MockWebhookPayload>;
      return typeof payload.providerIntentId === "string" ? payload.providerIntentId : null;
    } catch {
      return null;
    }
  },

  verifyWebhook(rawBody: string, signatureHeader: string | null, _credentials, _context): PaymentVerification | null {
    if (!signatureHeader) return null;

    const expected = Buffer.from(sign(rawBody), "hex");
    let received: Buffer;
    try {
      received = Buffer.from(signatureHeader, "hex");
    } catch {
      return null;
    }
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;

    let payload: MockWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as MockWebhookPayload;
    } catch {
      return null;
    }
    if (payload.status !== "succeeded" && payload.status !== "failed") return null;
    if (typeof payload.providerIntentId !== "string" || typeof payload.eventId !== "string") return null;

    return {
      providerIntentId: payload.providerIntentId,
      providerEventId: payload.eventId,
      status: payload.status,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      failureReason: payload.failureReason,
    };
  },
};
