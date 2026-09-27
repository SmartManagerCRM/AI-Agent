import { platformOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env-core";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

import { mockPaymentProvider } from "./mock";
import { moyasarProvider } from "./moyasar";
import type { PaymentCredentials, PaymentProvider } from "./provider";
import { tapProvider } from "./tap";

/**
 * Every payment provider wired in. Credentials are per-tenant (each
 * business connects its own Moyasar/Tap merchant account — money goes
 * straight to that business, never pools in one platform account), loaded
 * from `tenant_payment_config` inside `initiatePayment` below and passed
 * into whichever of these the order's chosen payment method names — never
 * baked into the provider objects themselves. `mock` stays registered for
 * tests/dev; it's never one of the methods a real tenant can enable
 * (`tenant_payment_config.enabled_methods`'s own check constraint doesn't
 * allow it).
 */
export const providers: Record<string, PaymentProvider> = {
  mock: mockPaymentProvider,
  moyasar: moyasarProvider,
  tap: tapProvider,
};

const CASH_METHODS = new Set(["cash_on_delivery", "pay_on_table"]);

export type InitiatePaymentResult =
  | { ok: true; checkoutUrl: string | null }
  | { ok: false; error: string };

/**
 * Starts (or idempotently resumes) a payment attempt for an order, or —
 * for Cash on Delivery / Pay on Table — records that the order is
 * confirmed and awaiting in-person payment with nothing further to do
 * (`checkoutUrl: null`, meaning "no redirect needed"). The provider itself
 * is never asserted by this function or its caller: `create_payment_attempt`
 * (SQL, SECURITY DEFINER) derives it from the cart's own stored
 * `payment_method`, the same "the server derives it from what was already
 * stored" discipline `create_order_from_cart` already applies to
 * fulfillment type and the order total.
 */
export async function initiatePayment(
  supabase: TypedSupabaseClient,
  tenantId: string,
  orderId: string,
): Promise<InitiatePaymentResult> {
  const { data, error } = await supabase.rpc("create_payment_attempt", { p_order_id: orderId });
  if (error || !data?.[0]) {
    return { ok: false, error: error?.message ?? "Could not start a payment for this order." };
  }
  const attempt = data[0];

  if (CASH_METHODS.has(attempt.provider)) {
    return { ok: true, checkoutUrl: null };
  }

  const provider = providers[attempt.provider];
  if (!provider) return { ok: false, error: `Unsupported payment method: ${attempt.provider}.` };

  const { data: currencyRow } = await supabase
    .from("currencies")
    .select("exponent")
    .eq("code", attempt.currency)
    .maybeSingle();
  const currencyExponent = currencyRow?.exponent ?? 2;

  const credentials = await loadCredentials(supabase, tenantId);
  if (!provider.configured(credentials)) {
    return { ok: false, error: `${attempt.provider} isn't set up yet for this business.` };
  }

  const intentResult = await provider.createIntent(
    {
      paymentId: attempt.payment_id,
      orderNumber: attempt.order_number,
      amountMinor: attempt.amount_minor,
      currency: attempt.currency,
      currencyExponent,
      callbackUrl: toAbsoluteAgentUrl(`/pay/${attempt.payment_id}`),
    },
    credentials,
  );
  if (!intentResult.ok) return { ok: false, error: intentResult.error };

  const { error: recordError } = await supabase.rpc("record_payment_provider_intent", {
    p_payment_id: attempt.payment_id,
    p_provider_intent_id: intentResult.value.providerIntentId,
  });
  if (recordError) return { ok: false, error: recordError.message };

  return { ok: true, checkoutUrl: toAbsoluteAgentUrl(intentResult.value.checkoutUrl) };
}

/**
 * Reads one tenant's stored Moyasar/Tap secret keys. Callers only ever
 * come from server-side payment code (`initiatePayment` above, and the
 * webhook route via `loadCredentialsForTenant`) — never exposed to a
 * client, and never read through anything but a service-role client, since
 * `tenant_payment_config`'s own RLS (`settings.write`, not `settings.read`)
 * would otherwise hide it from plain staff anyway.
 */
export async function loadCredentials(supabase: TypedSupabaseClient, tenantId: string): Promise<PaymentCredentials> {
  const { data } = await supabase
    .from("tenant_payment_config")
    .select("moyasar_secret_key, tap_secret_key")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return { moyasarSecretKey: data?.moyasar_secret_key ?? null, tapSecretKey: data?.tap_secret_key ?? null };
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
