import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Benefits } from "@/components/site/landing/benefits";
import { Categories } from "@/components/site/landing/categories";
import { Faq } from "@/components/site/landing/faq";
import { Hero } from "@/components/site/landing/hero";
import { HowItWorks } from "@/components/site/landing/how-it-works";
import { PricingSection } from "@/components/site/landing/pricing-section";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { announcedTrialDays } from "@/lib/site/pricing";
import { pageMetadata } from "@/server/site/metadata";
import { loadPublicPlans } from "@/server/site/public-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: isLocale(locale) ? locale : DEFAULT_LOCALE, namespace: "site.seo" });
  return pageMetadata(isLocale(locale) ? locale : DEFAULT_LOCALE, "", t("title"), t("description"));
}

/** The public landing page (ai-agent.smartmanager.me/). */
export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const plans = await loadPublicPlans();
  const trialDays = announcedTrialDays(plans);
  return (
    <>
      <Hero locale={locale} trialDays={trialDays} />
      <Categories locale={locale} />
      <Benefits />
      <HowItWorks />
      <PricingSection locale={locale} plans={plans} />
      <Faq trialDays={trialDays} />
    </>
  );
}
