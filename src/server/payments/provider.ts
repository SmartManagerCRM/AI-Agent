/**
 * Provider-agnostic payment interface (spec §17, §63, §64), mirroring
 * `AIProvider` (`src/server/ai/provider.ts`): nothing outside
 * `src/server/payments/` should call a payment vendor's SDK or verify its
 * webhook signature directly — every caller goes through this shape. A
 * real provider (Stripe, PayPal, ...) is a second implementation of this
 * interface added later; only `src/server/payments/service.ts` needs to
 * change to wire it in, never the schema, the webhook route, or any
 * commerce code.
 */
export type PaymentIntent = {
  provider: string;
  providerIntentId: string;
  /** Where the customer completes payment — relative or absolute. */
  checkoutUrl: string;
};

export type PaymentVerification = {
  providerIntentId: string;
  providerEventId: string;
  status: "succeeded" | "failed";
  amountMinor: number;
  currency: string;
  failureReason?: string;
};

export type PaymentProviderResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type CreateIntentInput = {
  paymentId: string;
  orderNumber: number;
  amountMinor: number;
  currency: string;
};

export type PaymentProvider = {
  readonly name: string;
  /** The HTTP header the webhook route reads the signature from (provider-specific, e.g. Stripe's `Stripe-Signature`). */
  readonly webhookSignatureHeader: string;
  /** Whether this provider has what it needs to run (an env credential set, for a real provider). */
  configured(): boolean;
  /** Starts a payment attempt with the provider; returns where to send the customer. */
  createIntent(input: CreateIntentInput): Promise<PaymentProviderResult<PaymentIntent>>;
  /**
   * Verifies a webhook delivery's authenticity and extracts the outcome.
   * Returns `null` when the signature does not check out — callers must
   * treat that exactly like "no event happened", never fall back to
   * trusting the payload.
   */
  verifyWebhook(rawBody: string, signatureHeader: string | null): PaymentVerification | null;
};
