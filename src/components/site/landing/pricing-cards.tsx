"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import type { Locale } from "@/i18n/locales";

import { SiteIcon, type SiteIconName } from "../icons";

export type PlanView = {
  key: string;
  name: string;
  description: string;
  price: string;
  billed: string | null;
  interval: "month" | "year";
  perMonth: string | null;
  monthsFree: number | null;
  trialDays: number;
  conversations: string | null;
  /** The plan's branch limit (null: no limit, not shown). */
  branches: number | null;
  features: string[];
  popular: boolean;
};

type Card = { family: string; monthly: PlanView | null; annual: PlanView | null; savings: number | null };

const CARD_ICONS: { icon: SiteIconName; tone: string }[] = [
  { icon: "store", tone: "bg-sky-50 text-sky-600" },
  { icon: "barChart", tone: "bg-emerald-50 text-emerald-600" },
  { icon: "crown", tone: "bg-amber-50 text-amber-500" },
  { icon: "star", tone: "bg-violet-50 text-violet-600" },
];

export function PricingCards({
  locale,
  cards,
  bestSaving,
  initialInterval,
}: {
  locale: Locale;
  cards: Card[];
  bestSaving: number | null;
  initialInterval: "month" | "year";
}) {
  const t = useTranslations("site.pricing");
  const hasAnnual = cards.some((c) => c.annual);
  const [interval, setInterval] = useState<"month" | "year">(hasAnnual ? initialInterval : "month");

  return (
    <>
      {hasAnnual && (
        <div className="mt-8 flex justify-center">
          <div role="radiogroup" aria-label={t("billing")} className="inline-flex items-center gap-1 rounded-full border border-emerald-100 bg-white p-1.5 shadow-sm" data-testid="billing-toggle">
            {(["month", "year"] as const).map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={interval === i}
                onClick={() => setInterval(i)}
                data-testid={`billing-${i}`}
                className={`site-focus flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition ${
                  interval === i ? "bg-gradient-to-b from-[#13985f] to-[#0b6a47] text-white shadow" : "text-slate-600 hover:text-[#0c1a33]"
                }`}
              >
                {i === "month" ? t("monthly") : t("annual")}
                {i === "year" && bestSaving !== null && (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${interval === "year" ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-800"}`}>
                    {t("save", { percent: bestSaving })}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <ul className={`mx-auto mt-10 grid max-w-[1120px] gap-6 ${cards.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2"} ${cards.length === 2 ? "max-w-[760px]" : ""}`}>
        {cards.map((card, index) => {
          const plan = (interval === "year" ? card.annual : card.monthly) ?? card.monthly ?? card.annual;
          if (!plan) return null;
          const look = CARD_ICONS[index % CARD_ICONS.length];
          return (
            <li
              key={card.family}
              data-testid={`plan-${card.family}`}
              className={`relative flex flex-col rounded-3xl bg-white p-7 transition ${
                plan.popular
                  ? "border-2 border-emerald-500 shadow-[0_30px_60px_-30px_rgba(14,138,92,0.55)] lg:-translate-y-2"
                  : "border border-slate-200/80 shadow-[0_20px_40px_-30px_rgba(12,26,51,0.4)]"
              }`}
            >
              {plan.popular && (
                <span className="absolute -top-3.5 start-1/2 -translate-x-1/2 rounded-full bg-gradient-to-b from-[#13985f] to-[#0b6a47] px-4 py-1 text-[11px] font-extrabold uppercase tracking-wider text-white shadow rtl:translate-x-1/2">
                  {t("popular")}
                </span>
              )}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-extrabold text-[#0c1a33]">{plan.name}</h3>
                  {plan.description && <p className="mt-1 text-sm text-slate-500">{plan.description}</p>}
                </div>
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${look.tone}`}>
                  <SiteIcon name={look.icon} size={24} />
                </span>
              </div>

              <div className="mt-5">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[2.6rem] font-extrabold leading-none tracking-tight text-[#0c1a33]" data-testid="plan-price">
                    {plan.price}
                  </span>
                  <span className="text-base font-medium text-slate-500">{plan.interval === "year" ? t("perYear") : t("perMonth")}</span>
                </p>
                <div className="mt-2 flex min-h-[22px] flex-wrap items-center gap-2 text-xs font-semibold">
                  {plan.interval === "year" && card.savings !== null && (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">{t("save", { percent: card.savings })}</span>
                  )}
                  {plan.interval === "year" && plan.perMonth && <span className="text-slate-500">{t("perMonthEquivalent", { price: plan.perMonth })}</span>}
                  {plan.interval === "year" && plan.monthsFree && <span className="text-slate-500">· {t("monthsFree", { n: plan.monthsFree })}</span>}
                  {plan.billed && <span className="text-slate-400">{plan.billed}</span>}
                </div>
              </div>

              <ul className="mt-5 flex flex-1 flex-col gap-2.5 text-[15px] text-[#33415c]">
                {plan.conversations && (
                  <li className="flex gap-2.5">
                    <Check />
                    {t("conversationsMonth", { n: plan.conversations })}
                  </li>
                )}
                {plan.branches !== null && (
                  <li className="flex gap-2.5" data-testid="plan-branches">
                    <Check />
                    {t("branches", { n: plan.branches })}
                  </li>
                )}
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check />
                    {f}
                  </li>
                ))}
                {/* Every plan: the team sets the business up for free once it moves to a paid plan. */}
                <li className="flex gap-2.5" data-testid="plan-free-onboarding">
                  <Check />
                  {t("freeOnboarding")}
                </li>
              </ul>

              <Link
                href={`/${locale}/signup?plan=${encodeURIComponent(plan.key)}`}
                className={`site-focus mt-7 h-14 rounded-2xl text-base ${plan.popular ? "site-btn-primary" : "site-btn-outline"}`}
                data-testid={`plan-cta-${card.family}`}
              >
                {t("startTrial")}
                <SiteIcon name="arrowRight" size={18} className="rtl:rotate-180" />
              </Link>
              {plan.trialDays > 0 && <p className="mt-3 text-center text-xs font-medium text-slate-500">{t("trialNote", { days: plan.trialDays })}</p>}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Check() {
  return (
    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
      <SiteIcon name="check" size={12} strokeWidth={3} />
    </span>
  );
}
