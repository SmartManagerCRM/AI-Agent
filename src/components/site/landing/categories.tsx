"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import type { Locale } from "@/i18n/locales";
import { BUSINESS_CATEGORIES, DEMO_AGENT_SLUG, type BusinessCategory } from "@/lib/site/config";

import { SiteIcon, type SiteIconName } from "../icons";

const LOOK: Record<BusinessCategory, { icon: SiteIconName; card: string; chip: string }> = {
  restaurants: { icon: "utensils", card: "bg-emerald-50/80", chip: "text-emerald-600" },
  retail: { icon: "bag", card: "bg-sky-50/80", chip: "text-sky-600" },
  salons: { icon: "scissors", card: "bg-pink-50/80", chip: "text-pink-500" },
  fitness: { icon: "dumbbell", card: "bg-violet-50/80", chip: "text-violet-600" },
  clinics: { icon: "heartPulse", card: "bg-rose-50/80", chip: "text-rose-600" },
  hotels: { icon: "bed", card: "bg-orange-50/80", chip: "text-orange-500" },
  events: { icon: "calendar", card: "bg-fuchsia-50/80", chip: "text-fuchsia-600" },
  more: { icon: "dots", card: "bg-indigo-50/80", chip: "text-indigo-600" },
};

/**
 * "Works for all types of businesses": each card opens what the AI Agent
 * does for that kind of business, with the live demo and the free trial.
 */
export function Categories({ locale }: { locale: Locale }) {
  const t = useTranslations("site.categories");
  const [open, setOpen] = useState<BusinessCategory | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  const choose = (c: BusinessCategory) => {
    setOpen((current) => (current === c ? null : c));
    requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <section className="border-b border-slate-100 bg-white" aria-labelledby="categories-title">
      <div className="mx-auto max-w-[1240px] px-4 py-10 sm:px-6 lg:px-8">
        <h2 id="categories-title" className="text-center text-xs font-bold uppercase tracking-[0.3em] text-slate-600">
          {t("title")}
        </h2>
        <ul className="-mx-4 mt-6 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-8">
          {BUSINESS_CATEGORIES.map((c) => (
            <li key={c} className="snap-start">
              <button
                type="button"
                onClick={() => choose(c)}
                aria-expanded={open === c}
                aria-controls="category-panel"
                data-testid={`category-${c}`}
                className={`site-focus flex h-[104px] w-[118px] flex-col items-center justify-center gap-2.5 rounded-2xl border px-2 text-center text-[13px] font-semibold leading-tight text-[#0c1a33] transition hover:-translate-y-0.5 hover:shadow-md sm:w-full ${LOOK[c].card} ${
                  open === c ? "border-emerald-500 shadow-md ring-2 ring-emerald-500/20" : "border-transparent"
                }`}
              >
                <SiteIcon name={LOOK[c].icon} size={30} className={LOOK[c].chip} strokeWidth={2.2} />
                <span className="whitespace-pre-line">{t(`items.${c}.name`)}</span>
              </button>
            </li>
          ))}
        </ul>

        <div ref={panel} id="category-panel" role="region" aria-live="polite" aria-label={open ? t(`items.${open}.title`) : t("title")}>
          {open && (
            <div className="site-pop mt-6 grid gap-6 rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-6 sm:p-8 md:grid-cols-[1fr_auto] md:items-center" data-testid="category-detail">
              <div>
                <h3 className="text-xl font-extrabold text-[#0c1a33] sm:text-2xl">{t(`items.${open}.title`)}</h3>
                <ul className="mt-4 grid gap-2.5 text-[15px] text-[#33415c] sm:grid-cols-3">
                  {(["p1", "p2", "p3"] as const).map((p) => (
                    <li key={p} className="flex gap-2">
                      <SiteIcon name="check" size={18} className="mt-0.5 text-emerald-600" strokeWidth={2.6} />
                      {t(`items.${open}.${p}`)}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex flex-col gap-2.5 sm:flex-row md:flex-col">
                <a href={`/agent/${DEMO_AGENT_SLUG}`} target="_blank" rel="noopener" className="site-btn-outline site-focus h-12 rounded-2xl px-5 text-sm">
                  <SiteIcon name="play" size={14} className="fill-current rtl:-scale-x-100" strokeWidth={1.5} />
                  {t("tryDemo")}
                </a>
                <Link href={`/${locale}/pricing`} className="site-btn-primary site-focus h-12 rounded-2xl px-5 text-sm">
                  {t("startTrial")}
                  <SiteIcon name="arrowRight" size={16} className="rtl:rotate-180" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
