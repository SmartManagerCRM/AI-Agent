import { getTranslations } from "next-intl/server";

import { SECTION_IDS } from "@/lib/site/config";

import { SiteIcon, type SiteIconName } from "../icons";

const BENEFITS: { key: string; icon: SiteIconName; tone: string }[] = [
  { key: "sales", icon: "cart", tone: "bg-emerald-50 text-emerald-600" },
  { key: "available", icon: "clock", tone: "bg-sky-50 text-sky-600" },
  { key: "delighted", icon: "heart", tone: "bg-rose-50 text-rose-500" },
  { key: "simple", icon: "bolt", tone: "bg-blue-50 text-blue-600" },
];

/** Features: the four benefits, under the business categories. */
export async function Benefits() {
  const t = await getTranslations("site.benefits");
  return (
    <section id={SECTION_IDS.features} className="bg-white" aria-labelledby="benefits-title">
      <h2 id="benefits-title" className="sr-only">
        {t("title")}
      </h2>
      <ul className="mx-auto grid max-w-[1240px] gap-x-6 gap-y-8 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8 lg:py-14">
        {BENEFITS.map((b) => (
          <li key={b.key} className="flex items-start gap-4">
            <span className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full ${b.tone}`}>
              <SiteIcon name={b.icon} size={30} strokeWidth={2.1} />
            </span>
            <div>
              <h3 className="text-lg font-extrabold text-[#0c1a33]">{t(`${b.key}.title`)}</h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-slate-500">{t(`${b.key}.text`)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
