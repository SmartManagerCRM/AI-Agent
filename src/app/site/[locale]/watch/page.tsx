import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { AD_VIDEO, AdPlayer } from "@/components/site/ad-player";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { SITE_ORIGIN } from "@/lib/site/config";
import { pageMetadata } from "@/server/site/metadata";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.watch" });
  const meta = pageMetadata(locale, "/watch", t("metaTitle"), t("metaDescription"));
  return {
    ...meta,
    openGraph: {
      ...meta.openGraph,
      type: "video.other",
      images: [{ url: `${SITE_ORIGIN}${AD_VIDEO.poster}`, width: 720, height: 1280, alt: "SmartManager AI Agent" }],
      videos: [{ url: `${SITE_ORIGIN}${AD_VIDEO.src}`, type: "video/mp4", width: 1080, height: 1920 }],
    },
  };
}

/** The ad, full screen, with its end-card links clickable: ai-agent.smartmanager.me/watch. */
export default async function WatchPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  return <AdPlayer locale={locale} />;
}
