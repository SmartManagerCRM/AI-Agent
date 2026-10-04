import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { SECTION_IDS } from "@/lib/site/config";
import { annualSavingsPercent, bestAnnualSaving, featureLines, pickText, planFamilies, type PublicPlan } from "@/lib/site/pricing";
import { siteDisplayMoney } from "@/server/site/public-data";

import { PricingCards, type PlanView } from "./pricing-cards";

/**
 * Pricing, from Super Admin → Subscriptions & Plans (never written here):
 * one card per plan family, Monthly / Annual. Prices are the plans' own;
 * with a header currency chosen they're shown converted (≈), with what's
 * actually billed underneath.
 */
export async function PricingSection({
  locale,
  plans,
  initialInterval = "month",
  as: Heading = "h2",
}: {
  locale: Locale;
  plans: PublicPlan[];
  initialInterval?: "month" | "year";
  as?: "h1" | "h2";
}) {
  const t = await getTranslations("site.pricing");
  const dm = await siteDisplayMoney(locale);
  const nf = new Intl.NumberFormat(locale);
  const families = planFamilies(plans);

  const view = (plan: PublicPlan | null, monthly: PublicPlan | null): PlanView | null => {
    if (!plan) return null;
    const own = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: plan.currency,
      minimumFractionDigits: plan.price_minor % 10 ** plan.exponent === 0 ? 0 : plan.exponent,
      maximumFractionDigits: plan.exponent,
    }).format(plan.price_minor / 10 ** plan.exponent);
    const converted = dm.code && dm.code !== plan.currency;
    const shown = converted ? dm.money(plan.price_minor, plan.currency, plan.exponent).replace(/[.,]00(?=\D*$)/, "") : own;
    const perMonth =
      plan.billing_interval === "year" ? dm.money(Math.round(plan.price_minor / 12), plan.currency, plan.exponent) : null;
    const monthsFree =
      plan.billing_interval === "year" && monthly && monthly.price_minor > 0
        ? Math.round((monthly.price_minor * 12 - plan.price_minor) / monthly.price_minor)
        : null;
    return {
      key: plan.key,
      name: pickText(plan.name, locale) || plan.key,
      description: pickText(plan.description, locale),
      price: converted ? `≈ ${shown}` : shown,
      billed: converted ? t("billedIn", { price: own }) : null,
      interval: plan.billing_interval,
      perMonth,
      monthsFree: monthsFree && monthsFree > 0 ? monthsFree : null,
      trialDays: plan.trial_days,
      conversations: plan.conversation_limit ? nf.format(plan.conversation_limit) : null,
      features: featureLines(plan, locale),
      popular: plan.is_popular,
    };
  };

  const cards = families.map((f) => ({
    family: f.family,
    monthly: view(f.monthly, f.monthly),
    annual: view(f.annual, f.monthly),
    savings: annualSavingsPercent(f.monthly, f.annual),
  }));

  return (
    <section id={SECTION_IDS.pricing} className="site-mint-bg" aria-labelledby="pricing-title">
      <div className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="relative flex flex-col items-center text-center">
          <span className="mb-4 rounded-full bg-gradient-to-b from-amber-400 to-orange-500 px-5 py-2 text-xs font-extrabold uppercase tracking-wider text-white shadow-[0_10px_20px_-10px_rgba(234,88,12,0.7)] lg:absolute lg:end-0 lg:top-1 lg:mb-0">
            {t("offer")}
          </span>
          <Heading id="pricing-title" className="text-3xl font-extrabold tracking-tight text-[#0c1a33] sm:text-[2.6rem]">
            {t("title")}
          </Heading>
          <p className="mt-3 max-w-2xl text-lg text-[#33415c]">{t("subtitle")}</p>
        </div>
        {cards.length === 0 ? (
          <p className="mx-auto mt-10 max-w-md rounded-2xl bg-white p-6 text-center text-slate-600 shadow-sm" data-testid="pricing-empty">
            {t("none")}
          </p>
        ) : (
          <PricingCards locale={locale} cards={cards} bestSaving={bestAnnualSaving(families)} initialInterval={initialInterval} />
        )}
      </div>
    </section>
  );
}
