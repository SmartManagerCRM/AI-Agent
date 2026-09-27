import type { ReactNode } from "react";
import { headers } from "next/headers";

import { DEFAULT_LOCALE, isLocale, localeDirection } from "@/i18n/locales";

import "./globals.css";

export const metadata = {
  title: "SmartManager AI Agent",
  description: "Give your business an AI employee.",
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
