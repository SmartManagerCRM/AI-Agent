import { notFound } from "next/navigation";

import { simulateMockSubscriptionPaymentAction } from "@/server/billing/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export const dynamic = "force-dynamic";

/**
 * The console-scoped mock checkout page for subscription payments (spec
 * §98 Phase 7) — the billing counterpart to Phase 6's agent-facing
 * `/agent/pay/[paymentId]`. It lives inside the authenticated console
 * (the owner already has a session) rather than on the public agent host,
 * so it reads via `createUserClient()` and RLS, not a service-role
 * bypass. Its buttons never mark the payment themselves — see
 * `simulateMockSubscriptionPaymentAction`.
 */
export default async function SubscriptionPayPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string; paymentId: string }>;
}) {
  const { locale, slug, paymentId } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: payment } = await supabase
    .from("subscription_payments")
    .select("id, status, provider, plan_key, amount_minor, currency")
    .eq("id", paymentId)
    .eq("tenant_id", tenant.id)
    .maybeSingle();
  if (!payment) notFound();

  const { data: currencyRow } = await supabase.from("currencies").select("exponent").eq("code", payment.currency).maybeSingle();
  const exponent = currencyRow?.exponent ?? 2;
  const amount = (payment.amount_minor / 10 ** exponent).toFixed(exponent);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-6 py-10 text-center">
      <div>
        <h1 className="text-xl font-semibold capitalize">{payment.plan_key} plan</h1>
        <p className="mt-1 text-sm text-neutral-500">Subscription payment</p>
      </div>

      <div className="rounded-lg border border-neutral-200 px-8 py-6">
        <p className="text-3xl font-bold tracking-tight">
          {amount} {payment.currency}
        </p>
      </div>

      {payment.status === "pending" && payment.provider === "mock" && (
        <div className="flex flex-col items-center gap-3">
          <p className="max-w-xs text-xs text-neutral-400">
            This is a test payment page — no real payment gateway is connected yet.
          </p>
          <div className="flex gap-3">
            <form action={simulateMockSubscriptionPaymentAction}>
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="outcome" value="succeeded" />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                Simulate successful payment
              </button>
            </form>
            <form action={simulateMockSubscriptionPaymentAction}>
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="outcome" value="failed" />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <button type="submit" className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700">
                Simulate failed payment
              </button>
            </form>
          </div>
        </div>
      )}

      {payment.status === "succeeded" && <p className="text-sm font-medium text-green-700">Payment received — subscription active!</p>}
      {payment.status === "failed" && (
        <p className="text-sm font-medium text-red-700">This payment attempt failed — return to Billing to try again.</p>
      )}
    </div>
  );
}
