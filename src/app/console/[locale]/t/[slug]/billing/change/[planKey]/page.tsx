import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { PaySubmit } from "@/components/billing/pay-submit";
import { Button } from "@/components/console/button";
import { formatMoney } from "@/lib/money";
import { confirmUpgradeAction, manageBillingAction } from "@/server/billing/actions";
import { previewPaddleUpgrade } from "@/server/billing/paddle/subscriptions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export const dynamic = "force-dynamic";

/**
 * Billing → Upgrade: what the upgrade costs now — Paddle's own pro-rata
 * calculation for the rest of the current period (nothing is charged by
 * showing it) — and the button that pays it with the payment method on file.
 * The plan changes only once that payment succeeds; to pay with another
 * method, the owner updates it in Paddle's billing portal first.
 */
export default async function UpgradePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string; planKey: string }>;
  searchParams: Promise<{ declined?: string }>;
}) {
  const { locale, slug, planKey: rawPlanKey } = await params;
  const { declined } = await searchParams;
  const planKey = decodeURIComponent(rawPlanKey);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const billing = `/${locale}/${slug}/billing`;
  const t = await getTranslations("console.paddle.change");

  const preview = await previewPaddleUpgrade(supabase, tenant.id, planKey);
  if (!preview.ok) redirect(`${billing}?paddle=${preview.reason}`);
  const { quote, plan, currentPlanKey } = preview;

  const [{ data: currencies }, { data: currentPlan }] = await Promise.all([
    supabase.from("currencies").select("code, exponent").in("code", [quote.currency, plan.currency]),
    supabase.from("subscription_plans").select("name, billing_interval").eq("key", currentPlanKey).maybeSingle(),
  ]);
  const exponentOf = (code: string) => currencies?.find((c) => c.code === code)?.exponent ?? 2;
  const money = (amountMinor: number, currency: string) => formatMoney(amountMinor, currency, exponentOf(currency), locale);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  const tBilling = await getTranslations("console.billing");
  const cycle = (interval: string | undefined) => (interval === "month" || interval === "year" ? t(`cycle.${interval}`) : (interval ?? ""));
  const per = (interval: string) => (tBilling.has(`interval.${interval}`) ? tBilling(`interval.${interval}`) : interval);
  const nameOf = (name: Record<string, string> | null | undefined, key: string) => name?.[locale] ?? name?.en ?? key;
  const dueNow = money(quote.dueNowMinor, quote.currency);
  const renewalPrice = `${money(plan.price_minor, plan.currency)} / ${per(plan.billing_interval)}`;

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title", { plan: nameOf(plan.name, plan.key) })}</h1>

      {declined && (
        <p role="alert" data-testid="upgrade-declined" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {t("declined")}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
          <dt className="text-slate-500">{t("from")}</dt>
          <dd className="text-end font-medium text-slate-900">
            {nameOf(currentPlan?.name as Record<string, string> | null, currentPlanKey)} · {cycle(currentPlan?.billing_interval)}
          </dd>
          <dt className="text-slate-500">{t("to")}</dt>
          <dd className="text-end font-medium text-slate-900">
            {nameOf(plan.name, plan.key)} · {cycle(plan.billing_interval)}
          </dd>
          {quote.chargeMinor !== null && (
            <>
              <dt className="text-slate-500">{t("charge")}</dt>
              <dd className="text-end text-slate-900" dir="ltr">{money(quote.chargeMinor, quote.currency)}</dd>
            </>
          )}
          {quote.creditMinor !== null && quote.creditMinor > 0 && (
            <>
              <dt className="text-slate-500">{t("credit")}</dt>
              <dd className="text-end text-slate-900" dir="ltr">−{money(quote.creditMinor, quote.currency)}</dd>
            </>
          )}
        </dl>
        <div className="flex items-baseline justify-between gap-4 border-t border-slate-100 pt-3">
          <span className="font-semibold text-slate-900">{t("dueNow")}</span>
          <span className="text-2xl font-bold text-slate-900" dir="ltr" data-testid="upgrade-due-now">
            {dueNow}
          </span>
        </div>
        {quote.periodEnd && <p className="text-xs text-slate-500">{t("until", { date: fmtDate(quote.periodEnd), price: renewalPrice })}</p>}
      </section>

      <p className="text-sm text-slate-600">{t("onlyIfPaid")}</p>
      <p className="text-sm text-slate-600">{t("method")}</p>

      <div className="flex flex-wrap items-center gap-2">
        <form action={confirmUpgradeAction}>
          <input type="hidden" name="planKey" value={plan.key} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <PaySubmit label={t("pay", { amount: dueNow })} pendingLabel={t("confirming")} />
        </form>
        <form action={manageBillingAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" variant="secondary" data-testid="other-method">
            {t("otherMethod")}
          </Button>
        </form>
        <Link href={billing} className="px-2 py-2 text-sm font-medium text-slate-600 hover:text-slate-900">
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
