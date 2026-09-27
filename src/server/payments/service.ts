import { platformOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env-core";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

import { mockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./provider";

/**
 * The one payment provider wired in for the MVP. Swapping in a real one
 * (Stripe/PayPal) later means adding a second `PaymentProvider`
 * implementation and changing this one export — `initiatePayment` below,
 * the webhook route, and every commerce/order/tool caller are all written
 * against the interface, not against "mock" specifically.
 *
 * No `import "server-only"` (same reasoning as gemini.ts/mock.ts): kept
 * importable by unit tests.
 */
export const paymentProvider: PaymentProvider = mockPaymentProvider;

export type InitiatePaymentResult = { ok: true; checkoutUrl: string } | { ok: false; error: string };

/**
 * Starts (or idempotently resumes) a payment attempt for an order that is
 * `pending_payment` (spec §17). The amount is the order's own total,
 * re-read by `create_payment_attempt` (SQL, SECURITY DEFINER) — never
 * supplied by this function or anything upstream of it, the same
 * "backend computes the total" discipline `create_order_from_cart`
 * already applies to the order itself.
 *
 * A fresh provider intent is created on every call, reused attempt or
 * not — harmless for a provider with no real external side effect; a
 * real provider integration would instead want to reuse a still-valid
 * intent across reloads, which is a refinement for whenever a real
 * provider is actually added, not something the mock needs to solve.
 */
export async function initiatePayment(supabase: TypedSupabaseClient, orderId: string): Promise<InitiatePaymentResult> {
  const { data, error } = await supabase.rpc("create_payment_attempt", {
    p_order_id: orderId,
    p_provider: paymentProvider.name,
  });
  if (error || !data?.[0]) {
    return { ok: false, error: error?.message ?? "Could not start a payment for this order." };
  }
  const attempt = data[0];

  const intentResult = await paymentProvider.createIntent({
    paymentId: attempt.payment_id,
    orderNumber: attempt.order_number,
    amountMinor: attempt.amount_minor,
    currency: attempt.currency,
  });
  if (!intentResult.ok) return { ok: false, error: intentResult.error };

  const { error: recordError } = await supabase.rpc("record_payment_provider_intent", {
    p_payment_id: attempt.payment_id,
    p_provider_intent_id: intentResult.value.providerIntentId,
  });
  if (recordError) return { ok: false, error: recordError.message };

  return { ok: true, checkoutUrl: toAbsoluteAgentUrl(intentResult.value.checkoutUrl) };
}

function toAbsoluteAgentUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const env = serverEnv();
  const origin = platformOrigin(env.AGENT_SUBDOMAIN, {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
  });
  return `${origin}${path}`;
}
