import Image from "next/image";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { formatMoney } from "@/lib/money";
import { isLocale, localeDirection } from "@/i18n/locales";
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
 * (`src/server/payments/webhook.ts`). Styled with the Customer Agent's
 * visual system; the interface language is the one the agent host
 * negotiated for this request.
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

  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : "en";
  const t = await getTranslations({ locale, namespace: "agent.pay" });
  const exponent = currencyRow?.exponent ?? 2;
  const amount = formatMoney(payment.amount_minor, payment.currency.trim(), exponent, locale);
  const businessName =
    (tenant && (tenant.business_name[locale] ?? tenant.business_name[tenant.default_language] ?? Object.values(tenant.business_name)[0])) ?? "";

  return (
    <main lang={locale} dir={localeDirection(locale)} className="flex min-h-dvh flex-col items-center justify-center bg-agent-cream px-4 py-10">
      <div className="w-full max-w-md overflow-hidden rounded-[2rem] bg-white shadow-[0_30px_60px_-30px_rgba(5,42,34,0.45)] ring-1 ring-slate-900/5">
        <div
          className="flex flex-col items-center gap-2 px-6 pt-8 pb-7 text-center text-white"
          style={{ backgroundImage: "radial-gradient(circle at 85% 0%, rgba(47,201,154,0.35), transparent 45%), linear-gradient(160deg, #052a22 0%, #0b4f3f 60%, #0c6a53 100%)" }}
        >
          <p className="text-xs font-semibold tracking-wide text-agent-200 uppercase">{t("title")}</p>
          {businessName && <h1 className="text-xl font-bold">{businessName}</h1>}
          {order && <p className="text-sm text-white/75">{t("order", { number: order.order_number })}</p>}
          <p className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums">{amount}</p>
        </div>

        <div className="flex flex-col items-center gap-4 px-6 py-7 text-center">
          {payment.status === "pending" && payment.provider === "mock" && (
            <>
              <p className="rounded-2xl bg-amber-50 px-4 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100">{t("testNotice")}</p>
              <div className="flex w-full flex-col gap-2.5">
                <form action={simulateMockPaymentAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input type="hidden" name="outcome" value="succeeded" />
                  <button
                    type="submit"
                    className="h-13 w-full rounded-full bg-agent-700 text-base font-bold text-white shadow-lg shadow-agent-900/25 hover:bg-agent-800 focus-visible:ring-2 focus-visible:ring-agent-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                  >
                    {t("simulateSuccess")}
                  </button>
                </form>
                <form action={simulateMockPaymentAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input type="hidden" name="outcome" value="failed" />
                  <button
                    type="submit"
                    className="h-12 w-full rounded-full bg-white text-sm font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-agent-400 focus-visible:outline-none"
                  >
                    {t("simulateFailure")}
                  </button>
                </form>
              </div>
            </>
          )}

          {payment.status === "pending" && payment.provider !== "mock" && <p className="text-sm text-slate-600">{t("pending")}</p>}
          {payment.status === "succeeded" && (
            <p className="flex items-center gap-2 text-base font-bold text-agent-700">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-agent-500 text-white" aria-hidden="true">
                ✓
              </span>
              {t("succeeded")}
            </p>
          )}
          {payment.status === "failed" && <p className="text-sm font-semibold text-red-700">{t("failed")}</p>}

          <p className="flex items-center gap-1.5 text-xs text-slate-400">
            <Image src="/brand/logo-mark.png" alt="" width={16} height={16} className="rounded" />
            {t("secure")}
          </p>
        </div>
      </div>
    </main>
  );
}
