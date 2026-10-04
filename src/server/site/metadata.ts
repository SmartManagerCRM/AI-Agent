import type { Metadata } from "next";

import { LOCALES, type Locale } from "@/i18n/locales";
import { SITE_ORIGIN } from "@/lib/site/config";

/** A public page's URL: the English landing page is the bare root (the site's canonical address). */
export function publicUrl(locale: Locale, path: string): string {
  if (locale === "en" && path === "") return `${SITE_ORIGIN}/`;
  return `${SITE_ORIGIN}/${locale}${path}`;
}

/** Title, description, canonical URL, language alternates, Open Graph and X card for a public page. */
export function pageMetadata(locale: Locale, path: string, title: string, description: string, { index = true } = {}): Metadata {
  const languages = Object.fromEntries(LOCALES.map((l) => [l, publicUrl(l, path)]));
  const image = { url: `${SITE_ORIGIN}/brand/logo-full.png`, width: 1254, height: 1254, alt: "SmartManager AI Agent" };
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title,
    description,
    alternates: { canonical: publicUrl(locale, path), languages: { ...languages, "x-default": publicUrl("en", path) } },
    openGraph: {
      type: "website",
      url: publicUrl(locale, path),
      siteName: "SmartManager AI Agent",
      title,
      description,
      locale: { en: "en_US", ar: "ar_AR", fr: "fr_FR" }[locale],
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
    robots: index ? { index: true, follow: true } : { index: false, follow: true },
  };
}
