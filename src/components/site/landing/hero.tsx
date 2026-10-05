import Image from "next/image";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { DEMO_AGENT_SLUG } from "@/lib/site/config";

import { SiteIcon, type SiteIconName } from "../icons";
import { Phone, PhoneAgentBar } from "./phone";

const FLOATING: { key: string; icon: SiteIconName; tone: string }[] = [
  { key: "sales", icon: "barChart", tone: "bg-amber-50 text-amber-500" },
  { key: "customers", icon: "users", tone: "bg-emerald-50 text-emerald-600" },
  { key: "time", icon: "clock", tone: "bg-sky-50 text-sky-600" },
  { key: "languages", icon: "star", tone: "bg-orange-50 text-orange-500" },
];

const TILES: { key: string; icon: SiteIconName; tone: string }[] = [
  { key: "food", icon: "utensils", tone: "bg-orange-50 text-orange-500" },
  { key: "products", icon: "bag", tone: "bg-amber-50 text-amber-500" },
  { key: "book", icon: "calendar", tone: "bg-sky-50 text-sky-600" },
  { key: "offers", icon: "tag", tone: "bg-rose-50 text-rose-500" },
];

export async function Hero({ locale, trialDays }: { locale: Locale; trialDays: number | null }) {
  const t = await getTranslations("site.hero");
  const checks = [trialDays ? t("trial", { days: trialDays }) : null, t("noCard"), t("easySetup")].filter((c): c is string => !!c);

  return (
    <section className="site-hero-bg relative overflow-hidden" aria-labelledby="hero-title">
      {/* Café owner with a tablet: the open, blurred side sits behind the text (mirrored in Arabic). */}
      <Image
        src="/brand/hero-cafe.webp"
        alt=""
        fill
        preload
        sizes="100vw"
        className="pointer-events-none object-cover object-[70%_center] rtl:-scale-x-100"
      />
      <div
        className="pointer-events-none absolute inset-0 bg-white/80 lg:bg-transparent lg:bg-gradient-to-r lg:from-white/95 lg:via-white/75 lg:to-white/0 rtl:lg:bg-gradient-to-l"
        aria-hidden
      />
      <div className="relative mx-auto grid max-w-[1240px] items-center gap-10 px-4 pb-12 pt-10 sm:px-6 lg:grid-cols-[1.02fr_1fr] lg:gap-6 lg:px-8 lg:pb-12 lg:pt-12">
        <div className="site-rise flex flex-col items-start">
          <span className="rounded-full bg-emerald-100/70 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-emerald-900">{t("eyebrow")}</span>
          <h1 id="hero-title" className="mt-5 text-[2.35rem] font-extrabold leading-[1.08] tracking-tight text-[#0c1a33] sm:text-5xl lg:text-[3.35rem]">
            {t("titleLine1")}
            <br />
            {t("titleLine2")}
            <br />
            <span className="text-[#0e8a5c]">{t("titleAccent")}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-[#33415c] sm:text-[1.2rem]">
            {t("subtitle1")}
            <br className="hidden sm:block" /> {t("subtitle2")}
          </p>
          <div className="mt-8 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link href={`/${locale}/pricing`} className="site-btn-primary site-focus h-14 rounded-2xl px-7 text-base" data-testid="hero-start-trial">
              {t("startTrial")}
              <SiteIcon name="arrowRight" size={18} className="rtl:rotate-180" />
            </Link>
            <a
              href={`/agent/${DEMO_AGENT_SLUG}`}
              target="_blank"
              rel="noopener"
              className="site-btn-outline site-focus h-14 rounded-2xl px-6 text-base"
              data-testid="hero-watch-demo"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[#0e8a5c] text-[#0e8a5c]">
                <SiteIcon name="play" size={13} className="ms-0.5 fill-current rtl:-scale-x-100" strokeWidth={1.5} />
              </span>
              {t("watchDemo")}
              <span className="sr-only">{t("opensNewTab")}</span>
            </a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-6 gap-y-2.5 text-sm font-semibold text-[#0c1a33]">
            {checks.map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0e8a5c] text-white">
                  <SiteIcon name="check" size={12} strokeWidth={3} />
                </span>
                {c}
              </li>
            ))}
          </ul>
        </div>

        <HeroVisual t={t} />
      </div>
    </section>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"site.hero">>>;

function HeroVisual({ t }: { t: T }) {
  return (
    <div className="relative mx-auto w-full max-w-[600px]" aria-label={t("visualLabel")} role="img">
      <div className="relative h-[430px] sm:h-[500px] lg:h-[540px]">
        <Image
          src="/brand/agent-character.png"
          alt=""
          width={480}
          height={326}
          priority
          sizes="(min-width: 1024px) 250px, 190px"
          className="site-float absolute bottom-2 start-[-6%] z-20 w-[44%] max-w-[250px] drop-shadow-xl sm:start-[-3%] lg:w-[38%] xl:w-[44%]"
        />

        {/* Phones and tablets only: on wider screens the café owner in the photo takes this place. */}
        <Phone className="absolute start-[33%] top-2 z-10 h-[400px] w-[205px] rotate-[4deg] sm:start-[30%] sm:h-[470px] sm:w-[240px] lg:hidden">
          <PhoneAgentBar title="SmartManager AI Agent" online={t("phone.online")} onClose={false} />
          <div className="flex flex-1 flex-col gap-2.5 bg-gradient-to-b from-white to-emerald-50/40 px-3 py-3 text-[10.5px] leading-snug">
            <p className="max-w-[85%] rounded-2xl rounded-ss-sm bg-slate-100 px-3 py-2 text-slate-800">
              {t("phone.hello")}
              <br />
              {t("phone.help")}
            </p>
            <p className="ms-auto max-w-[85%] rounded-2xl rounded-se-sm bg-[#0e8a5c] px-3 py-2 text-white">{t("phone.ask")}</p>
            <p className="max-w-[85%] rounded-2xl rounded-ss-sm bg-slate-100 px-3 py-2 text-slate-800">{t("phone.answer")}</p>
            <div className="grid grid-cols-2 gap-2">
              {TILES.map((tile) => (
                <span key={tile.key} className="flex flex-col items-center gap-1 rounded-xl border border-slate-100 bg-white px-1 py-2.5 text-center font-semibold text-slate-800 shadow-sm">
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tile.tone}`}>
                    <SiteIcon name={tile.icon} size={17} />
                  </span>
                  {t(`phone.tiles.${tile.key}`)}
                </span>
              ))}
            </div>
            <span className="mt-auto flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-slate-400">
              <SiteIcon name="plus" size={13} />
              <span className="flex-1">{t("phone.type")}</span>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0e8a5c] text-white">
                <SiteIcon name="send" size={12} />
              </span>
            </span>
          </div>
        </Phone>

        <ul className="absolute end-0 top-6 z-30 hidden flex-col gap-3 sm:flex">
          {FLOATING.map((f, i) => (
            <li
              key={f.key}
              className="site-card flex w-[176px] items-center gap-3 rounded-2xl px-3.5 py-3 site-rise lg:w-[158px] xl:w-[176px]"
              style={{ animationDelay: `${150 + i * 90}ms` }}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${f.tone}`}>
                <SiteIcon name={f.icon} size={21} />
              </span>
              <span className="text-[13px] font-bold leading-tight text-[#0c1a33]">{t(`floating.${f.key}`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:hidden">
        {FLOATING.map((f) => (
          <li key={f.key} className="site-card flex items-center gap-2.5 rounded-2xl px-3 py-2.5">
            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${f.tone}`}>
              <SiteIcon name={f.icon} size={19} />
            </span>
            <span className="text-[12.5px] font-bold leading-tight text-[#0c1a33]">{t(`floating.${f.key}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
