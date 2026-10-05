import "server-only";

import { loadCredentials, providers } from "@/server/payments/service";
import { serviceClient } from "@/server/supabase/clients";
import type { Json } from "@/types/database";

import { parseJson } from "./amounts";
import type { PaymentProvider, PaymentVerification } from "./provider";

export type WebhookOutcome =
  | { ok: true; result: "succeeded" | "failed" | "ignored" }
  | { ok: false; error: string };

/**
 * The one place a payment outcome is ever recorded (spec §64: "payment
 * status only becomes 'paid' after server-side verification — never from
 * the frontend/customer/LLM"). Used by both the real webhook route
 * (`src/app/api/payments/webhook/[provider]/route.ts`, for whichever
 * external provider actually sent the request) and the mock checkout
 * page's "simulate" Server Action (`src/server/payments/actions.ts`).
 *
 * Verification is two-phase because credentials are per-tenant
 * (`src/server/payments/service.ts`): `extractProviderIntentId` pulls the
 * provider's own opaque id out of the payload with **no trust implied**
 * (it's used only as a lookup key), the matching `payments` row tells us
 * which tenant this claims to be about, and only THAT tenant's stored
 * secret is used to actually verify the signature. A forged id here just
 * means the lookup finds no payment — it can never mark anything paid.
 */
export async function processProviderWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookOutcome> {
  const providerIntentId = provider.extractProviderIntentId(rawBody);
  if (!providerIntentId) return { ok: false, error: "NOT_FOUND: no payment intent id in this webhook." };

  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, tenant_id, amount_minor, currency")
    .eq("provider", provider.name)
    .eq("provider_intent_id", providerIntentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "NOT_FOUND: no payment matches this provider intent." };

  const { data: currencyRow } = await supabase
    .from("currencies")
    .select("exponent")
    .eq("code", payment.currency)
    .maybeSingle();
  const currencyExponent = currencyRow?.exponent ?? 2;

  const credentials = await loadCredentials(supabase, payment.tenant_id);
  const verification = await provider.verifyWebhook(rawBody, signatureHeader, credentials, {
    currencyExponent,
    paymentId: payment.id,
    orderCurrency: payment.currency.trim(),
  });
  if (!verification) return { ok: false, error: "INVALID_SIGNATURE: webhook could not be verified." };

  return recordVerification(payment, verification, parseJson(rawBody) ?? { provider: provider.name });
}

type RecordedPayment = { id: string; amount_minor: number; currency: string };

/**
 * Records a verified outcome (a provider's signed webhook, or its own API's
 * answer). Defense in depth: a payment is never marked paid unless the
 * amount/currency the provider reports is exactly what we recorded when the
 * intent was created (a failure moves no money, and some providers report
 * no amount for a cancelled invoice).
 */
async function recordVerification(payment: RecordedPayment, verification: PaymentVerification, raw: unknown): Promise<WebhookOutcome> {
  const supabase = serviceClient();
  if (verification.status === "succeeded" && (payment.amount_minor !== verification.amountMinor || payment.currency.trim() !== verification.currency)) {
    return { ok: false, error: "MISMATCH: webhook amount/currency does not match the recorded payment." };
  }
  if (verification.status === "succeeded") {
    const { error } = await supabase.rpc("mark_payment_succeeded", {
      p_payment_id: payment.id,
      p_provider_event_id: verification.providerEventId,
      p_raw: raw as Json,
    });
    // Raw `error.message` is never returned here (spec §61 hardening): this
    // route is public and unauthenticated — a provider's own retried
    // request is all a real caller needs, not our internal error text.
    if (error) return { ok: false, error: "INTERNAL_ERROR: could not record payment outcome." };
    return { ok: true, result: "succeeded" };
  }

  const { error } = await supabase.rpc("mark_payment_failed", {
    p_payment_id: payment.id,
    p_provider_event_id: verification.providerEventId,
    p_raw: raw as Json,
    p_reason: verification.failureReason ?? null,
  });
  if (error) return { ok: false, error: "INTERNAL_ERROR: could not record payment outcome." };
  return { ok: true, result: "failed" };
}

/**
 * Asks the payment's provider for its outcome (its own API, this business's
 * credentials) and records it — when the customer comes back to the payment
 * page. Only providers with a status API (Stripe, PayPal, HyperPay,
 * MyFatoorah) take part; a pending payment with no final outcome yet stays
 * pending. Safe to call repeatedly: an outcome is recorded once.
 */
export async function syncPaymentStatus(paymentId: string): Promise<"succeeded" | "failed" | "pending" | "unchanged"> {
  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, tenant_id, provider, provider_intent_id, status, amount_minor, currency")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment || payment.status !== "pending" || !payment.provider_intent_id) return "unchanged";
  const provider = providers[payment.provider];
  if (!provider?.syncStatus) return "unchanged";

  const { data: currencyRow } = await supabase.from("currencies").select("exponent").eq("code", payment.currency).maybeSingle();
  const credentials = await loadCredentials(supabase, payment.tenant_id);
  if (!provider.configured(credentials)) return "unchanged";
  const verification = await provider.syncStatus(payment.provider_intent_id, credentials, {
    currencyExponent: currencyRow?.exponent ?? 2,
    paymentId: payment.id,
    orderCurrency: payment.currency.trim(),
  });
  if (!verification) return "pending";
  const outcome = await recordVerification(payment, verification, { source: "status_check", provider: payment.provider, status: verification.status });
  if (!outcome.ok) {
    console.error(`[payments] ${payment.provider} status not recorded: ${outcome.error.split(":")[0]}`);
    return "unchanged";
  }
  return outcome.result === "ignored" ? "unchanged" : outcome.result;
}
