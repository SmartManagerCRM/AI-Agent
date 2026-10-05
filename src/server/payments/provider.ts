/**
 * Provider-agnostic payment interface (spec §17, §63, §64), mirroring
 * `AIProvider` (`src/server/ai/provider.ts`): nothing outside
 * `src/server/payments/` should call a payment vendor's SDK or verify its
 * webhook signature directly — every caller goes through this shape.
 *
 * Credentials are a parameter, not provider state (`src/server/payments/
 * service.ts` §"per-tenant credentials"): each business connects its own
 * Moyasar/Tap merchant account, so a provider object here is a stateless
 * singleton whose methods take that specific tenant's key each time they're
 * called — never a per-tenant instance constructed with a baked-in secret.
 */
export type PaymentCredentials = {
  moyasarSecretKey?: string | null;
  tapSecretKey?: string | null;
  stripeSecretKey?: string | null;
  stripeWebhookSecret?: string | null;
  paypalClientId?: string | null;
  paypalClientSecret?: string | null;
  paypalTestMode?: boolean;
  hyperpayAccessToken?: string | null;
  hyperpayEntityId?: string | null;
  hyperpayMadaEntityId?: string | null;
  hyperpayTestMode?: boolean;
  myfatoorahApiToken?: string | null;
  myfatoorahCountry?: string | null;
  myfatoorahTestMode?: boolean;
};

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

/** What a provider is told about the payment it is verifying: never trusted input, our own record. */
export type PaymentContext = {
  /** Minor-unit exponent of the payment's currency. */
  currencyExponent: number;
  /** Our payment id (providers that bound their payment to it check it). */
  paymentId?: string;
  /** The currency we recorded for the payment. */
  orderCurrency?: string;
};

export type PaymentProviderResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type CreateIntentInput = {
  paymentId: string;
  orderNumber: number;
  amountMinor: number;
  currency: string;
  /** Minor-unit exponent for `currency` (e.g. 2 for SAR, 3 for KWD) — providers that speak decimal major-unit amounts (Tap) need this to convert; ones that already speak minor units (Moyasar) ignore it. */
  currencyExponent: number;
  /** Where the provider should send the customer back after attempting payment (a redirect landing page, never the source of truth for the outcome — only a webhook is). */
  callbackUrl: string;
};

export type PaymentProvider = {
  readonly name: string;
  /** The HTTP header the webhook route reads the signature from (provider-specific, e.g. Moyasar's `x-moyasar-signature`). */
  readonly webhookSignatureHeader: string;
  /** Whether this provider has what it needs to run for this tenant (a stored secret key, for a real provider). */
  configured(credentials: PaymentCredentials): boolean;
  /** Starts a payment attempt with the provider; returns where to send the customer. */
  createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>>;
  /**
   * Pulls the provider's own opaque payment/charge id out of a webhook
   * body, with **no trust implied** — this is only ever used as a lookup
   * key (which `payments` row, and so which tenant's credentials, this
   * event claims to be about) before `verifyWebhook` below actually checks
   * the signature with that tenant's own secret. Returning a wrong or
   * attacker-supplied id here just means the lookup finds no matching
   * payment; it can never mark anything paid on its own.
   */
  extractProviderIntentId(rawBody: string): string | null;
  /**
   * Verifies a webhook delivery's authenticity (using the credentials of
   * the tenant `extractProviderIntentId` resolved to) and extracts the
   * outcome. Returns `null` when the signature does not check out —
   * callers must treat that exactly like "no event happened", never fall
   * back to trusting the payload.
   */
  verifyWebhook(
    rawBody: string,
    signatureHeader: string | null,
    credentials: PaymentCredentials,
    context: PaymentContext,
  ): PaymentVerification | null | Promise<PaymentVerification | null>;
  /**
   * Asks the provider's own API (with this tenant's credentials) for the
   * payment's outcome — the authoritative answer, used when the customer
   * comes back from the provider's page and, for providers whose webhooks
   * carry no signature we can check, as their webhook verification too.
   * Completes what the provider needs completing on our side first (PayPal:
   * capturing an approved order). `null` while there is no final outcome.
   */
  syncStatus?(
    providerIntentId: string,
    credentials: PaymentCredentials,
    context: PaymentContext,
  ): Promise<PaymentVerification | null>;
};
