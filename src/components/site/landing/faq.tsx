import { getTranslations } from "next-intl/server";

import { SECTION_IDS } from "@/lib/site/config";

import { SiteIcon } from "../icons";

export const FAQ_KEYS = ["what", "who", "restaurants", "shops", "salons", "order", "book", "pay", "qr", "website", "languages", "trial", "afterTrial", "changePlan"] as const;

/** Frequently asked questions — native disclosure widgets (keyboard and screen-reader friendly without script). */
export async function Faq({ trialDays }: { trialDays: number | null }) {
  const t = await getTranslations("site.faq");
  return (
    <section id={SECTION_IDS.faq} className="bg-white" aria-labelledby="faq-title">
      <div className="mx-auto max-w-[880px] px-4 py-16 sm:px-6 lg:py-20">
        <div className="text-center">
          <span className="rounded-full bg-emerald-100/70 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-emerald-900">{t("eyebrow")}</span>
          <h2 id="faq-title" className="mt-5 text-3xl font-extrabold tracking-tight text-[#0c1a33] sm:text-[2.4rem]">
            {t("title")}
          </h2>
        </div>
        <div className="mt-10 flex flex-col gap-3" data-testid="faq">
          {FAQ_KEYS.map((k) => (
            <details key={k} className="group site-card rounded-2xl px-5 open:shadow-md" data-testid={`faq-${k}`}>
              <summary className="site-focus flex cursor-pointer list-none items-center justify-between gap-4 rounded-xl py-4 text-start text-base font-bold text-[#0c1a33] [&::-webkit-details-marker]:hidden">
                {t(`items.${k}.q`)}
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 transition group-open:rotate-45">
                  <SiteIcon name="plus" size={18} />
                </span>
              </summary>
              <p className="pb-5 text-[15px] leading-relaxed text-[#33415c]">
                {k === "trial" ? t("items.trial.a", { days: trialDays ?? 7 }) : t(`items.${k}.a`)}
              </p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
