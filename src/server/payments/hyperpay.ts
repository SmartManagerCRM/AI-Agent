import { callProvider, toMinorUnits } from "./amounts";
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
 * HyperPay (OPPWA "COPYandPAY") — mada, Visa and Mastercard for the
 * business's own HyperPay merchant account.
 *
 * HyperPay has no hosted page of its own: a checkout is prepared on the
 * server (`POST /v1/checkouts` with the access token and an entity id), and
 * HyperPay's payment form (`paymentWidgets.js?checkoutId=…`, served by
 * HyperPay — card details never touch this app) is shown on our payment page
 * (`/pay/<paymentId>`). In Saudi Arabia mada has its own entity id, so a
 * second checkout is prepared with it when the business set one: the
 * customer picks mada or Visa / Mastercard on the payment page.
 *
 * The outcome is read from HyperPay's API (`GET /v1/checkouts/{id}/payment`)
 * when the form sends the customer back to the payment page — never taken
 * from the redirect itself. HyperPay's result codes: `000.000.*`,
 * `000.100.1*`, `000.3*`, `000.6*` are successful payments; `000.200.*` (and
 * `800.400.5*`, `100.400.500`) still pending; `200.*` mean no payment has
 * been made on the checkout yet; anything else is a rejected payment.
 *
 * Amounts are decimals with two places (HyperPay's format), so currencies
 * with three decimals can only be charged in whole tens of their smallest
 * unit.
 */
const LIVE_BASE = "https://eu-prod.oppwa.com";
const TEST_BASE = "https://eu-test.oppwa.com";

export const hyperpayBase = (credentials: PaymentCredentials) => (credentials.hyperpayTestMode ? TEST_BASE : LIVE_BASE);

export type HyperpayCheckout = { brand: "mada" | "cards"; checkoutId: string };

/** Our provider_intent_id for HyperPay: one or two checkouts, `cards:<id>|mada:<id>`. */
export function parseHyperpayIntent(intent: string | null | undefined): HyperpayCheckout[] {
  if (!intent) return [];
  return intent
    .split("|")
    .map((part) => {
      const [brand, checkoutId] = part.split(":", 2);
      return (brand === "mada" || brand === "cards") && checkoutId && /^[A-Za-z0-9.\-]{8,64}$/.test(checkoutId) ? { brand, checkoutId } : null;
    })
    .filter((c): c is HyperpayCheckout => c !== null);
}

const SUCCESS = /^(000\.000\.|000\.100\.1|000\.[36])/;
const PENDING = /^(000\.200|800\.400\.5|100\.400\.500)/;
const NOT_STARTED = /^200\./;

export type HyperpayResultKind = "succeeded" | "pending" | "not_started" | "failed";
export function classifyHyperpayCode(code: string | null | undefined): HyperpayResultKind {
  if (!code) return "not_started";
  if (SUCCESS.test(code)) return "succeeded";
  if (PENDING.test(code)) return "pending";
  if (NOT_STARTED.test(code)) return "not_started";
  return "failed";
}

/** The decimal amount HyperPay takes ("92.00"), or null when the amount can't be written with two decimals. */
export function hyperpayAmount(amountMinor: number, exponent: number): string | null {
  if (exponent <= 2) return (amountMinor / 10 ** exponent).toFixed(2);
  const step = 10 ** (exponent - 2);
  return amountMinor % step === 0 ? (amountMinor / 10 ** exponent).toFixed(2) : null;
}

type CheckoutResponse = { id?: string; result?: { code?: string; description?: string } };
type PaymentResponse = { id?: string; amount?: string; currency?: string; merchantTransactionId?: string; result?: { code?: string; description?: string } };

async function prepareCheckout(credentials: PaymentCredentials, entityId: string, amount: string, input: CreateIntentInput): Promise<string | null> {
  const body = new URLSearchParams({
    entityId,
    amount,
    currency: input.currency,
    paymentType: "DB",
    merchantTransactionId: input.paymentId,
  });
  const result = await callProvider(`${hyperpayBase(credentials)}/v1/checkouts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${credentials.hyperpayAccessToken}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const checkout = result?.json as CheckoutResponse | null;
  return result?.ok && checkout?.id && /^000\.200\.100/.test(checkout.result?.code ?? "") ? checkout.id : null;
}

async function checkoutResult(credentials: PaymentCredentials, entityId: string, checkoutId: string): Promise<PaymentResponse | null> {
  const result = await callProvider(`${hyperpayBase(credentials)}/v1/checkouts/${checkoutId}/payment?entityId=${encodeURIComponent(entityId)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${credentials.hyperpayAccessToken}` },
  });
  return (result?.json as PaymentResponse | null) ?? null;
}

async function syncCheckouts(intent: string, credentials: PaymentCredentials, context: PaymentContext): Promise<PaymentVerification | null> {
  if (!credentials.hyperpayAccessToken) return null;
  let failure: PaymentVerification | null = null;
  for (const { brand, checkoutId } of parseHyperpayIntent(intent)) {
    const entityId = brand === "mada" ? credentials.hyperpayMadaEntityId : credentials.hyperpayEntityId;
    if (!entityId) continue;
    const payment = await checkoutResult(credentials, entityId, checkoutId);
    if (!payment) continue;
    // Prepared by us for this payment.
    if (context.paymentId && payment.merchantTransactionId && payment.merchantTransactionId !== context.paymentId) continue;
    const kind = classifyHyperpayCode(payment.result?.code);
    const base = {
      providerIntentId: intent,
      amountMinor: toMinorUnits(payment.amount, context.currencyExponent) ?? -1,
      currency: payment.currency ?? "",
    };
    if (kind === "succeeded") {
      return { ...base, status: "succeeded", providerEventId: `hyperpay:${checkoutId}:${payment.id ?? ""}:succeeded` };
    }
    if (kind === "failed" && !failure) {
      failure = {
        ...base,
        status: "failed",
        providerEventId: `hyperpay:${checkoutId}:${payment.id ?? ""}:failed`,
        amountMinor: base.amountMinor < 0 ? 0 : base.amountMinor,
        failureReason: payment.result?.description ?? payment.result?.code,
      };
    }
  }
  return failure;
}

export const hyperpayProvider: PaymentProvider = {
  name: "hyperpay",
  // HyperPay's notifications are encrypted per merchant and not used: outcomes come from its API.
  webhookSignatureHeader: "x-authentication-tag",

  configured(credentials: PaymentCredentials): boolean {
    return !!credentials.hyperpayAccessToken && !!credentials.hyperpayEntityId;
  },

  async createIntent(input: CreateIntentInput, credentials: PaymentCredentials): Promise<PaymentProviderResult<PaymentIntent>> {
    if (!credentials.hyperpayAccessToken || !credentials.hyperpayEntityId) return { ok: false, error: "HyperPay isn't set up yet for this business." };
    const amount = hyperpayAmount(input.amountMinor, input.currencyExponent);
    if (!amount) return { ok: false, error: `HyperPay can't charge this ${input.currency} amount (two decimals at most).` };

    const cards = await prepareCheckout(credentials, credentials.hyperpayEntityId, amount, input);
    if (!cards) return { ok: false, error: "HyperPay rejected the payment request." };
    const parts = [`cards:${cards}`];
    if (credentials.hyperpayMadaEntityId) {
      const mada = await prepareCheckout(credentials, credentials.hyperpayMadaEntityId, amount, input);
      if (mada) parts.unshift(`mada:${mada}`);
    }
    // HyperPay's form is shown on our own payment page.
    return { ok: true, value: { provider: "hyperpay", providerIntentId: parts.join("|"), checkoutUrl: `/pay/${input.paymentId}` } };
  },

  extractProviderIntentId(): string | null {
    return null;
  },

  verifyWebhook(): null {
    return null;
  },

  syncStatus(providerIntentId, credentials, context) {
    return syncCheckouts(providerIntentId, credentials, context);
  },
};
