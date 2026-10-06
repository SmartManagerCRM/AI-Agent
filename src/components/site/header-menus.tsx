"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";

import { LOCALES, LOCALE_NATIVE_NAMES, type Locale } from "@/i18n/locales";
import { groupCurrencies } from "@/lib/currencies";
import { localePath } from "@/lib/site/locale-path";
import { setSiteCurrencyAction } from "@/server/site/actions";

import { SiteIcon } from "./icons";

/** A small pill menu (language, currency): button + list, closes on outside click / Escape. */
function PillMenu({
  label,
  value,
  children,
  testId,
  align = "end",
  compact = false,
}: {
  label: string;
  value: string;
  children: (close: () => void) => ReactNode;
  testId: string;
  align?: "start" | "end";
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" data-testid={testId}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${value}`}
        onClick={() => setOpen((v) => !v)}
        className={`site-focus flex items-center rounded-full border border-slate-200 bg-white font-semibold text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-slate-300 hover:bg-slate-50 ${
          compact ? "h-9 gap-1 px-2.5 text-[13px] max-[399px]:px-2" : "h-10 gap-1.5 px-3.5 text-sm"
        }`}
      >
        {value}
        <SiteIcon
          name="chevronDown"
          size={compact ? 13 : 15}
          className={`text-slate-500 transition-transform ${open ? "rotate-180" : ""} ${compact ? "max-[399px]:hidden" : ""}`}
        />
      </button>
      {open && (
        <div
          id={id}
          role="listbox"
          aria-label={label}
          className={`site-pop absolute z-50 max-h-80 min-w-40 overflow-y-auto ${compact ? "top-11" : "top-12"} rounded-2xl border border-slate-100 bg-white py-1.5 shadow-xl ${align === "end" ? "end-0" : "start-0"}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

const optionClass = (selected: boolean) =>
  `site-focus flex w-full items-center justify-between gap-3 px-4 py-2 text-start text-sm transition ${selected ? "bg-emerald-50 font-semibold text-emerald-800" : "text-slate-700 hover:bg-slate-50"}`;

export function LocaleMenu({ locale, align, compact }: { locale: Locale; align?: "start" | "end"; compact?: boolean }) {
  const t = useTranslations("site.header");
  const pathname = usePathname();
  return (
    <PillMenu label={t("language")} value={locale.toUpperCase()} testId="site-locale-menu" align={align} compact={compact}>
      {() =>
        LOCALES.map((l) => (
          <a
            key={l}
            role="option"
            aria-selected={l === locale}
            lang={l}
            href={localePath(pathname, l)}
            onClick={(e) => {
              // Keep the page's query (e.g. the plan chosen on the sign-up page) and section.
              e.preventDefault();
              window.location.assign(new URL(`${localePath(pathname, l)}${window.location.search}${window.location.hash}`, window.location.origin).href);
            }}
            className={optionClass(l === locale)}
          >
            <span>{LOCALE_NATIVE_NAMES[l]}</span>
            <span className="text-xs text-slate-400">{l.toUpperCase()}</span>
          </a>
        ))
      }
    </PillMenu>
  );
}

export function CurrencyMenu({ currencies, current, align, compact }: { currencies: string[]; current: string; align?: "start" | "end"; compact?: boolean }) {
  const t = useTranslations("site.header");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <PillMenu label={t("currency")} value={pending ? "…" : current} testId="site-currency-menu" align={align} compact={compact}>
      {(close) => {
        const { mena, international } = groupCurrencies(currencies);
        // Middle East & North Africa first, then the rest (headings only when both have some).
        return [
          { key: "mena", label: t("mena"), codes: mena },
          { key: "international", label: t("international"), codes: international },
        ]
          .filter((g) => g.codes.length)
          .map((g, _, groups) => (
            <div key={g.key} role="group" aria-label={g.label}>
              {groups.length > 1 && (
                <p className="sticky top-0 bg-white px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
              )}
              {g.codes.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="option"
                  aria-selected={code === current}
                  onClick={() => {
                    close();
                    start(async () => {
                      if (await setSiteCurrencyAction(code)) router.refresh();
                    });
                  }}
                  className={optionClass(code === current)}
                >
                  {code}
                </button>
              ))}
            </div>
          ));
      }}
    </PillMenu>
  );
}
