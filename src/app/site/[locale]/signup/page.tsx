import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { SiteIcon } from "@/components/site/icons";
import { SignupForm } from "@/components/site/signup-form";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { countryOptions } from "@/lib/site/countries";
import { pickText } from "@/lib/site/pricing";
import { readDisplayCurrency } from "@/server/platform/display-currency";
import { pageMetadata } from "@/server/site/metadata";
import { loadPublicPlans, loadSiteInfo } from "@/server/site/public-data";
import { anonymousClient } from "@/server/supabase/clients";
import { currentUser, myTenantMemberships } from "@/server/tenant/context";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.signup" });
  return pageMetadata(locale, "/signup", t("metaTitle"), t("subtitle"), { index: false });
}

/** Sign up on the plan chosen on the pricing page (?plan=<key>) — kept in the URL, so it survives a refresh. */
export default async function SignupPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ plan?: string }> }) {
  const [{ locale: raw }, { plan: planKey }] = await Promise.all([params, searchParams]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const plans = await loadPublicPlans();
  const plan = plans.find((p) => p.key === planKey);
  if (!plan) redirect(`/${locale}/pricing`);

  const user = await currentUser();
  if (user && (await myTenantMemberships()).length > 0) redirect(`/${locale}/welcome`);

  const [t, info, chosen, { data: types }] = await Promise.all([
    getTranslations("site.signup"),
    loadSiteInfo(),
    readDisplayCurrency(),
    anonymousClient().from("business_types").select("key, name").eq("is_active", true).order("key"),
  ]);
  const price = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: plan.currency,
    minimumFractionDigits: plan.price_minor % 10 ** plan.exponent === 0 ? 0 : plan.exponent,
    maximumFractionDigits: plan.exponent,
  }).format(plan.price_minor / 10 ** plan.exponent);
  const annual = plan.billing_interval === "year";
  const businessTypes = (types ?? [])
    .map((b) => ({ value: b.key, label: pickText(b.name as Record<string, string>, locale) || b.key }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  return (
    <section className="site-hero-bg">
      <div className="mx-auto grid max-w-[1100px] gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[360px_1fr] lg:py-16">
        <aside className="flex flex-col gap-4" aria-label={t("yourPlan")}>
          <div className="site-card rounded-3xl p-6" data-testid="signup-plan">
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">{t("yourPlan")}</p>
            <h2 className="mt-2 text-2xl font-extrabold text-[#0c1a33]">{pickText(plan.name, locale) || plan.key}</h2>
            <p className="mt-1 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-800">{annual ? t("annual") : t("monthly")}</p>
            <p className="mt-4 text-3xl font-extrabold text-[#0c1a33]">
              {price} <span className="text-base font-medium text-slate-500">{annual ? t("perYear") : t("perMonth")}</span>
            </p>
            {plan.trial_days > 0 && (
              <p className="mt-4 flex items-center gap-2 rounded-2xl bg-[#0c1a33] px-4 py-3 text-sm font-bold text-white">
                <SiteIcon name="check" size={16} className="text-emerald-400" strokeWidth={3} />
                {t("trial", { days: plan.trial_days })}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-500">{t("noCharge")}</p>
            <Link href={`/${locale}/pricing${annual ? "?billing=annual" : ""}`} className="site-focus mt-4 inline-flex text-sm font-semibold text-emerald-700 underline">
              {t("changePlan")}
            </Link>
          </div>
        </aside>

        <div className="site-card rounded-3xl p-6 sm:p-8">
          <h1 className="text-3xl font-extrabold tracking-tight text-[#0c1a33]">{t("title")}</h1>
          <p className="mt-2 text-[15px] text-[#33415c]">{t("subtitle")}</p>
          <div className="mt-7">
            <SignupForm
              locale={locale}
              plan={plan.key}
              signedInEmail={user?.email ?? null}
              businessTypes={businessTypes}
              countries={countryOptions(locale)}
              currencies={info.currencies}
              defaultCurrency={chosen && info.currencies.includes(chosen) ? chosen : info.currencies.includes("USD") ? "USD" : info.currencies[0]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
