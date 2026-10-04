import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Faq } from "@/components/site/landing/faq";
import { PricingSection } from "@/components/site/landing/pricing-section";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { announcedTrialDays } from "@/lib/site/pricing";
import { pageMetadata } from "@/server/site/metadata";
import { loadPublicPlans } from "@/server/site/public-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.pricing" });
  return pageMetadata(locale, "/pricing", t("metaTitle"), t("subtitle"));
}

/** The pricing page: plans from Super Admin, Monthly / Annual (?billing=annual preselects it). */
export default async function PricingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ billing?: string }>;
}) {
  const [{ locale: raw }, { billing }] = await Promise.all([params, searchParams]);
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const plans = await loadPublicPlans();
  return (
    <>
      <PricingSection locale={locale} plans={plans} initialInterval={billing === "annual" ? "year" : "month"} as="h1" />
      <Faq trialDays={announcedTrialDays(plans)} />
    </>
  );
}
