import "server-only";

import type { PaymentProvider } from "@/server/payments/provider";
import { serviceClient } from "@/server/supabase/clients";

export type SubscriptionWebhookOutcome =
  | { ok: true; result: "succeeded" | "failed" }
  | { ok: false; error: string };

/**
 * The subscription-billing counterpart to
 * `src/server/payments/webhook.ts`'s `processProviderWebhook` — same
 * verify-then-cross-check-then-record shape, kept as its own function
 * (not a branch inside the order one) because the two domains have
 * nothing in common past "verify a signature": different table, different
 * SQL functions, different downstream effect (a subscription's period,
 * not an order's status). The webhook route
 * (`src/app/api/payments/webhook/[provider]/route.ts`) is what dispatches
 * to whichever domain a given provider intent actually belongs to — the
 * one place allowed to know about both.
 */
export async function processSubscriptionProviderWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signatureHeader: string | null,
): Promise<SubscriptionWebhookOutcome> {
  // Subscription billing is platform-level (the SaaS's own revenue from
  // tenants, not a tenant's own money — see ARCHITECTURE_ASSESSMENT.md's
  // note on why Moyasar/Tap are per-tenant but this domain stayed
  // mock-only), so there are no per-tenant credentials to load here: the
  // two-phase extract-then-verify shape below exists only to satisfy
  // `PaymentProvider`'s shared interface uniformly across both domains.
  const providerIntentId = provider.extractProviderIntentId(rawBody);
  if (!providerIntentId) return { ok: false, error: "NOT_FOUND: no payment intent id in this webhook." };

  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("subscription_payments")
    .select("id, amount_minor, currency")
    .eq("provider", provider.name)
    .eq("provider_intent_id", providerIntentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "NOT_FOUND: no subscription payment matches this provider intent." };

  const { data: currencyRow } = await supabase.from("currencies").select("exponent").eq("code", payment.currency).maybeSingle();
  const verification = provider.verifyWebhook(rawBody, signatureHeader, {}, { currencyExponent: currencyRow?.exponent ?? 2 });
  if (!verification) return { ok: false, error: "INVALID_SIGNATURE: webhook could not be verified." };

  if (payment.amount_minor !== verification.amountMinor || payment.currency !== verification.currency) {
    return { ok: false, error: "MISMATCH: webhook amount/currency does not match the recorded payment." };
  }

  if (verification.status === "succeeded") {
    const { error } = await supabase.rpc("mark_subscription_payment_succeeded", {
      p_payment_id: payment.id,
      p_provider_event_id: verification.providerEventId,
      p_raw: JSON.parse(rawBody),
    });
    // Raw `error.message` is never returned here (spec §61 hardening): this
    // route is public and unauthenticated — a provider's own retried
    // request is all a real caller needs, not our internal error text.
    if (error) return { ok: false, error: "INTERNAL_ERROR: could not record payment outcome." };
    return { ok: true, result: "succeeded" };
  }

  const { error } = await supabase.rpc("mark_subscription_payment_failed", {
    p_payment_id: payment.id,
    p_provider_event_id: verification.providerEventId,
    p_raw: JSON.parse(rawBody),
    p_reason: verification.failureReason ?? null,
  });
  if (error) return { ok: false, error: "INTERNAL_ERROR: could not record payment outcome." };
  return { ok: true, result: "failed" };
}
