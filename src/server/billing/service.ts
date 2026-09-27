import { paymentProvider } from "@/server/payments/service";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

export type InitiateSubscriptionPaymentResult = { ok: true; checkoutPath: string } | { ok: false; error: string };

/**
 * Starts (or resumes) a subscription payment for a chosen plan (spec §98
 * Phase 7). Reuses the same `PaymentProvider` Phase 6 built for order
 * payments (`src/server/payments/`) — there is still only one provider,
 * one signing scheme, one verification path — but subscription billing is
 * its own domain (`subscription_payments`, its own SQL functions): a
 * subscription is paid again every period, so unlike an order payment a
 * past success must never block a future one (the DB's own partial unique
 * index only excludes a *pending* duplicate, not a succeeded history row).
 *
 * `supabase` must be the caller's own user-scoped client (from
 * `createUserClient()`) — `create_subscription_payment_attempt` checks
 * `billing.write` against `auth.uid()`, which a service-role client has
 * none of. The provider-intent-recording step that follows is service-role
 * only regardless of who initiated it, same as order payments.
 */
export async function initiateSubscriptionPayment(
  supabase: TypedSupabaseClient,
  tenantId: string,
  planKey: string,
): Promise<InitiateSubscriptionPaymentResult> {
  const { data, error } = await supabase.rpc("create_subscription_payment_attempt", {
    p_tenant_id: tenantId,
    p_plan_key: planKey,
    p_provider: paymentProvider.name,
  });
  if (error || !data?.[0]) {
    return { ok: false, error: error?.message ?? "Could not start a subscription payment." };
  }
  const attempt = data[0];

  const intentResult = await paymentProvider.createIntent({
    paymentId: attempt.payment_id,
    orderNumber: 0,
    amountMinor: attempt.amount_minor,
    currency: attempt.currency,
  });
  if (!intentResult.ok) return { ok: false, error: intentResult.error };

  const service = serviceClient();
  const { error: recordError } = await service.rpc("record_subscription_payment_provider_intent", {
    p_payment_id: attempt.payment_id,
    p_provider_intent_id: intentResult.value.providerIntentId,
  });
  if (recordError) return { ok: false, error: recordError.message };

  // The mock provider's own checkoutUrl (`/pay/<id>`) is Phase 6's
  // agent-facing mock checkout page; billing's is a console-scoped page
  // this tenant's owner is already signed into, so this builds its own
  // path from the payment id rather than using the generic field. A real
  // provider's checkoutUrl (its own hosted page) would be used as-is.
  return { ok: true, checkoutPath: `billing/pay/${attempt.payment_id}` };
}
