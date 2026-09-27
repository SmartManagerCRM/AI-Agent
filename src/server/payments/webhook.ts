import "server-only";

import { serviceClient } from "@/server/supabase/clients";

import type { PaymentProvider } from "./provider";

export type WebhookOutcome =
  | { ok: true; result: "succeeded" | "failed" | "ignored" }
  | { ok: false; error: string };

/**
 * The one place a payment outcome is ever recorded (spec §64: "payment
 * status only becomes 'paid' after server-side verification — never from
 * the frontend/customer/LLM"). Used by both the real webhook route
 * (`src/app/api/payments/webhook/[provider]/route.ts`, for whichever
 * external provider actually sent the request) and the mock checkout
 * page's "simulate" Server Action (`src/server/payments/actions.ts`),
 * which asks this exact function to process a payload it had the mock
 * provider sign — the same code path a real provider's server-to-server
 * webhook call would go through, not a shortcut that sets the outcome
 * directly.
 */
export async function processProviderWebhook(
  provider: PaymentProvider,
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookOutcome> {
  const verification = provider.verifyWebhook(rawBody, signatureHeader);
  if (!verification) return { ok: false, error: "INVALID_SIGNATURE: webhook could not be verified." };

  const supabase = serviceClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("id, amount_minor, currency")
    .eq("provider", provider.name)
    .eq("provider_intent_id", verification.providerIntentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "NOT_FOUND: no payment matches this provider intent." };

  // Defense in depth: even though this is our own mock today, a real
  // provider's webhook should never be trusted to report the amount that
  // was actually authorized without cross-checking it against what we
  // ourselves recorded when the intent was created.
  if (payment.amount_minor !== verification.amountMinor || payment.currency !== verification.currency) {
    return { ok: false, error: "MISMATCH: webhook amount/currency does not match the recorded payment." };
  }

  if (verification.status === "succeeded") {
    const { error } = await supabase.rpc("mark_payment_succeeded", {
      p_payment_id: payment.id,
      p_provider_event_id: verification.providerEventId,
      p_raw: JSON.parse(rawBody),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, result: "succeeded" };
  }

  const { error } = await supabase.rpc("mark_payment_failed", {
    p_payment_id: payment.id,
    p_provider_event_id: verification.providerEventId,
    p_raw: JSON.parse(rawBody),
    p_reason: verification.failureReason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, result: "failed" };
}
