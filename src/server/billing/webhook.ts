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
  const verification = provider.verifyWebhook(rawBody, signatureHeader);
  if (!verification) return { ok: false, error: "INVALID_SIGNATURE: webhook could not be verified." };

  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("subscription_payments")
    .select("id, amount_minor, currency")
    .eq("provider", provider.name)
    .eq("provider_intent_id", verification.providerIntentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "NOT_FOUND: no subscription payment matches this provider intent." };

  if (payment.amount_minor !== verification.amountMinor || payment.currency !== verification.currency) {
    return { ok: false, error: "MISMATCH: webhook amount/currency does not match the recorded payment." };
  }

  if (verification.status === "succeeded") {
    const { error } = await supabase.rpc("mark_subscription_payment_succeeded", {
      p_payment_id: payment.id,
      p_provider_event_id: verification.providerEventId,
      p_raw: JSON.parse(rawBody),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: "succeeded" };
  }

  const { error } = await supabase.rpc("mark_subscription_payment_failed", {
    p_payment_id: payment.id,
    p_provider_event_id: verification.providerEventId,
    p_raw: JSON.parse(rawBody),
    p_reason: verification.failureReason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: "failed" };
}
