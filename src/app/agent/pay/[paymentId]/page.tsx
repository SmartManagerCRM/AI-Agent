import { notFound } from "next/navigation";

import { simulateMockPaymentAction } from "@/server/payments/actions";
import { serviceClient } from "@/server/supabase/clients";

export const dynamic = "force-dynamic";

/**
 * The mock checkout page (spec §17 Payments — mock/test provider for the
 * MVP): reachable at `agent.<root>/pay/<paymentId>` (addendum-style clean
 * link, same host as the External Agent itself). It never marks a payment
 * itself; both buttons below go through `simulateMockPaymentAction`, which
 * asks the mock provider to sign a webhook and verifies it exactly like a
 * real provider's own notification would be verified
 * (`src/server/payments/webhook.ts`).
 */
export default async function PayPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const supabase = serviceClient();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, status, provider, amount_minor, currency, order_id, tenant_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) notFound();

  const [{ data: order }, { data: tenant }, { data: currencyRow }] = await Promise.all([
    supabase.from("orders").select("order_number").eq("id", payment.order_id).maybeSingle(),
    supabase.from("tenants").select("business_name, default_language").eq("id", payment.tenant_id).maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", payment.currency).maybeSingle(),
  ]);

  const exponent = currencyRow?.exponent ?? 2;
  const amount = (payment.amount_minor / 10 ** exponent).toFixed(exponent);
  const businessName =
    (tenant && (tenant.business_name[tenant.default_language] ?? Object.values(tenant.business_name)[0])) ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        {businessName && <h1 className="text-xl font-semibold">{businessName}</h1>}
        {order && <p className="mt-1 text-sm text-neutral-500">Order #{order.order_number}</p>}
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
            <form action={simulateMockPaymentAction}>
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="outcome" value="succeeded" />
              <button type="submit" className="rounded-full bg-neutral-900 px-4 py-2 text-sm font-medium text-white">
                Simulate successful payment
              </button>
            </form>
            <form action={simulateMockPaymentAction}>
              <input type="hidden" name="paymentId" value={payment.id} />
              <input type="hidden" name="outcome" value="failed" />
              <button type="submit" className="rounded-full border border-neutral-300 px-4 py-2 text-sm text-neutral-700">
                Simulate failed payment
              </button>
            </form>
          </div>
        </div>
      )}

      {payment.status === "succeeded" && <p className="text-sm font-medium text-green-700">Payment received — thank you!</p>}
      {payment.status === "failed" && (
        <p className="text-sm font-medium text-red-700">This payment attempt failed — return to the chat to try again.</p>
      )}
    </main>
  );
}
