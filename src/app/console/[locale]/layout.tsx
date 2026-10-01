import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { InstallAppButton, ServiceWorkerManager, type PwaLabels } from "@/components/pwa/pwa-shell";
import { isLocale } from "@/i18n/locales";
import { PWA_THEME_COLOR } from "@/lib/pwa/manifest";

// The console is the installable app (PWA): manifest, iOS home-screen
// metadata and the browser theme colour are declared here only, so the
// customer-facing Agent and the marketing site are never offered for install.
export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AI Agent", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  themeColor: PWA_THEME_COLOR,
};

export default async function ConsoleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (isLocale(locale)) setRequestLocale(locale);
  const t = await getTranslations("pwa");
  const labels: PwaLabels = {
    installTitle: t("installTitle"),
    installDescription: t("installDescription"),
    install: t("install"),
    notNow: t("notNow"),
    offline: t("offline"),
    updateAvailable: t("updateAvailable"),
    refresh: t("refresh"),
  };
  return (
    <>
      {children}
      <ServiceWorkerManager labels={labels} />
      <InstallAppButton labels={labels} />
    </>
  );
}
