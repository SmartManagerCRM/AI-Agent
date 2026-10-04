"use client";

import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { SECTION_IDS } from "@/lib/site/config";

import { CurrencyMenu, LocaleMenu } from "./header-menus";
import { SiteIcon } from "./icons";

/** The SmartManager AI Agent lockup: the official mark, the wordmark and the "AI Agent" pill (as on the logo). */
export function SiteLogo({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  return (
    <Link href={`/${locale}`} className="site-focus flex items-center gap-2 rounded-xl" aria-label="SmartManager AI Agent">
      <Image src="/brand/logo-mark.png" alt="" width={compact ? 44 : 54} height={compact ? 44 : 54} priority className="shrink-0" />
      <span className="flex flex-col items-center leading-none" dir="ltr">
        <span className={`site-wordmark font-extrabold tracking-tight ${compact ? "text-[19px]" : "text-[23px]"}`}>SmartManager</span>
        <span className={`mt-1 rounded-full bg-gradient-to-b from-[#16a06e] to-[#0b6b49] px-3 font-semibold text-white ${compact ? "text-[11px] leading-[17px]" : "text-[13px] leading-[20px]"}`}>
          AI Agent
        </span>
      </span>
    </Link>
  );
}

export function SiteHeader({ locale, currencies, currency }: { locale: Locale; currencies: string[]; currency: string }) {
  const t = useTranslations("site.header");
  const [open, setOpen] = useState(false);
  const nav = [
    { href: `/${locale}#${SECTION_IDS.features}`, label: t("features") },
    { href: `/${locale}#${SECTION_IDS.howItWorks}`, label: t("howItWorks") },
    { href: `/${locale}/pricing`, label: t("pricing") },
    { href: `/${locale}#${SECTION_IDS.faq}`, label: t("faq") },
  ];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200/60 bg-white/85 backdrop-blur-md supports-[backdrop-filter]:bg-white/75">
      <div className="mx-auto flex h-[76px] max-w-[1240px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <SiteLogo locale={locale} />

        <nav aria-label={t("mainNav")} className="hidden items-center gap-8 lg:flex">
          {nav.map((item) => (
            <Link key={item.href} href={item.href} className="site-focus rounded-md text-[15px] font-semibold text-slate-800 transition hover:text-emerald-700">
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden items-center gap-2.5 lg:flex">
          <CurrencyMenu currencies={currencies} current={currency} />
          <LocaleMenu locale={locale} />
          <Link href={`/${locale}/login`} className="site-focus ms-2 rounded-md px-2 text-[15px] font-semibold text-slate-800 transition hover:text-emerald-700">
            {t("signIn")}
          </Link>
          <Link href={`/${locale}/pricing`} className="site-btn-primary site-focus ms-1 h-11 px-5 text-[15px]">
            {t("startTrial")}
            <SiteIcon name="arrowRight" size={17} className="rtl:rotate-180" />
          </Link>
        </div>

        <div className="flex items-center gap-2 lg:hidden">
          <Link href={`/${locale}/pricing`} className="site-btn-primary site-focus hidden h-10 px-4 text-sm sm:inline-flex">
            {t("startTrial")}
          </Link>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            aria-controls="site-mobile-menu"
            aria-label={t("openMenu")}
            className="site-focus flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800"
          >
            <SiteIcon name="menu" size={22} />
          </button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t("menu")} id="site-mobile-menu">
          <button type="button" aria-label={t("closeMenu")} onClick={() => setOpen(false)} className="site-fade absolute inset-0 bg-slate-900/40" />
          <div className="site-drawer absolute inset-y-0 end-0 flex w-[min(88vw,380px)] flex-col gap-6 overflow-y-auto bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <SiteLogo locale={locale} compact />
              <button type="button" onClick={() => setOpen(false)} aria-label={t("closeMenu")} className="site-focus flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <SiteIcon name="close" size={20} />
              </button>
            </div>
            <nav aria-label={t("mainNav")} className="flex flex-col">
              {nav.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="site-focus flex items-center justify-between border-b border-slate-100 py-3.5 text-base font-semibold text-slate-800"
                >
                  {item.label}
                  <SiteIcon name="arrowRight" size={16} className="text-slate-400 rtl:rotate-180" />
                </Link>
              ))}
            </nav>
            <div className="flex items-center gap-2">
              <CurrencyMenu currencies={currencies} current={currency} align="start" />
              <LocaleMenu locale={locale} align="start" />
            </div>
            <div className="mt-auto flex flex-col gap-3">
              <Link href={`/${locale}/login`} onClick={() => setOpen(false)} className="site-btn-outline site-focus h-12 text-base">
                {t("signIn")}
              </Link>
              <Link href={`/${locale}/pricing`} onClick={() => setOpen(false)} className="site-btn-primary site-focus h-12 text-base">
                {t("startTrial")}
                <SiteIcon name="arrowRight" size={17} className="rtl:rotate-180" />
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
