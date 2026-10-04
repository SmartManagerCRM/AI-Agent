import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { LegalDocument } from "@/components/site/legal-document";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { pageMetadata } from "@/server/site/metadata";
import { loadSiteInfo } from "@/server/site/public-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.legal.terms" });
  return pageMetadata(locale, "/terms", t("metaTitle"), t("metaDescription"));
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  return <LegalDocument locale={locale} doc="terms" info={await loadSiteInfo()} />;
}
