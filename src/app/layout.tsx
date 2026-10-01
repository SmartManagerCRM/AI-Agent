import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";

import { DEFAULT_LOCALE, isLocale, localeDirection } from "@/i18n/locales";

import "./globals.css";

export const metadata: Metadata = {
  title: "SmartManager AI Agent",
  description: "SmartManager AI Agent — intelligent ordering and business automation.",
  // Generated from the official logo by scripts/generate-pwa-icons.mjs.
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "16x16 32x32 48x48" }],
    apple: [{ url: "/icons/icon-180.png", sizes: "180x180", type: "image/png" }],
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();
  const headerLocale = headerList.get("x-next-intl-locale");
  const locale = isLocale(headerLocale) ? headerLocale : DEFAULT_LOCALE;

  return (
    <html lang={locale} dir={localeDirection(locale)}>
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
