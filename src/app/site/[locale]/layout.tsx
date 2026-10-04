import "@fontsource-variable/plus-jakarta-sans";
import "@fontsource-variable/cairo";
import "./site.css";

import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";

import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { DEFAULT_LOCALE, isLocale, localeDirection } from "@/i18n/locales";
import { readDisplayCurrency } from "@/server/platform/display-currency";
import { loadSiteInfo } from "@/server/site/public-data";

/**
 * The public website (ai-agent.smartmanager.me): header, page, footer.
 * Client components get the `site` messages only.
 */
export default async function SiteLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  setRequestLocale(locale);
  const [messages, info, chosen, t] = await Promise.all([getMessages(), loadSiteInfo(), readDisplayCurrency(), getTranslations("site.header")]);
  const currency = chosen && info.currencies.includes(chosen) ? chosen : "USD";

  return (
    <NextIntlClientProvider locale={locale} messages={{ site: (messages as Record<string, unknown>).site } as never}>
      <div className="site flex min-h-screen flex-col" lang={locale} dir={localeDirection(locale)}>
        <a href="#main" className="site-focus sr-only z-50 rounded-lg bg-white px-4 py-2 font-semibold focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
          {t("skip")}
        </a>
        <SiteHeader locale={locale} currencies={info.currencies} currency={currency} />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter locale={locale} info={info} />
      </div>
    </NextIntlClientProvider>
  );
}
