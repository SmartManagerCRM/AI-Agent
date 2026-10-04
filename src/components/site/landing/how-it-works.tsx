import Image from "next/image";
import QRCode from "qrcode";
import { getTranslations } from "next-intl/server";

import { DEMO_AGENT_SLUG, SECTION_IDS, SITE_ORIGIN } from "@/lib/site/config";

import { SiteIcon, type SiteIconName } from "../icons";
import { Phone, PhoneAgentBar } from "./phone";

const STEPS: { key: string; icon: SiteIconName }[] = [
  { key: "signUp", icon: "user" },
  { key: "brain", icon: "fileText" },
  { key: "customize", icon: "sliders" },
  { key: "goLive", icon: "rocket" },
];

const MENU: { key: string; icon: SiteIconName }[] = [
  { key: "menu", icon: "utensils" },
  { key: "order", icon: "cart" },
  { key: "book", icon: "calendar" },
  { key: "availability", icon: "clock" },
  { key: "offers", icon: "tag" },
];

/** How it works: four steps, beside the QR table card a business puts out (its QR opens the live demo Agent). */
export async function HowItWorks() {
  const t = await getTranslations("site.how");
  const demoUrl = `${SITE_ORIGIN}/agent/${DEMO_AGENT_SLUG}`;
  const qrSvg = await QRCode.toString(demoUrl, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#0c1a33", light: "#ffffff" } });

  return (
    <section id={SECTION_IDS.howItWorks} className="site-mint-bg overflow-hidden" aria-labelledby="how-title">
      <div className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:px-8 lg:py-20">
        <div>
          <span className="rounded-full bg-emerald-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wider text-emerald-900">{t("eyebrow")}</span>
          <h2 id="how-title" className="mt-5 text-3xl font-extrabold leading-tight tracking-tight text-[#0c1a33] sm:text-[2.6rem]">
            {t("title1")}
            <br />
            {t("title2")}
          </h2>
          <p className="mt-4 max-w-lg text-lg leading-relaxed text-[#33415c]">{t("subtitle")}</p>

          <ol className="relative mt-10 grid gap-8 sm:grid-cols-4 sm:gap-4">
            <span className="absolute inset-x-[12%] top-8 hidden h-0.5 bg-emerald-200 sm:block" aria-hidden />
            {STEPS.map((s, i) => (
              <li key={s.key} className="relative flex gap-4 sm:flex-col sm:items-center sm:gap-0 sm:text-center">
                <span className="relative z-10 flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white text-emerald-600 shadow-[0_8px_24px_-12px_rgba(14,138,92,0.55)] ring-4 ring-emerald-50">
                  <SiteIcon name={s.icon} size={28} strokeWidth={2.2} />
                </span>
                {i < STEPS.length - 1 && <span className="absolute start-8 top-16 h-[calc(100%-2rem)] w-0.5 bg-emerald-200 sm:hidden" aria-hidden />}
                <div className="sm:mt-3">
                  <p className="text-xl font-extrabold text-[#0c1a33]">{i + 1}</p>
                  <h3 className="font-extrabold text-[#0c1a33]">{t(`steps.${s.key}.title`)}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{t(`steps.${s.key}.text`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative mx-auto h-[420px] w-full max-w-[540px] sm:h-[520px]">
          {/* The QR table card */}
          <div className="absolute start-1/2 top-2 z-10 w-[78%] max-w-[300px] -translate-x-1/2 -rotate-3 rtl:translate-x-1/2 sm:start-0 sm:top-14 sm:w-[58%] sm:translate-x-0 sm:rtl:translate-x-0">
            <div className="rounded-[2rem] bg-gradient-to-b from-[#7a5a32] to-[#4f3a20] p-2.5 shadow-[0_30px_60px_-25px_rgba(12,26,51,0.6)]">
              <div className="flex flex-col items-center rounded-[1.6rem] bg-gradient-to-b from-[#0f6a47] to-[#0a4a33] px-5 pb-6 pt-5 text-center text-white">
                <Image src="/brand/agent-avatar.png" alt="" width={64} height={64} className="rounded-full ring-4 ring-white/15" />
                <p className="mt-3 text-[15px] font-extrabold uppercase tracking-wide">{t("qr.scan")}</p>
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noopener"
                  className="site-focus mt-3 block rounded-2xl bg-white p-3"
                  aria-label={t("qr.label")}
                  data-testid="how-qr"
                >
                  <span className="block h-[130px] w-[130px] [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} />
                </a>
                <p className="mt-3 text-xl font-extrabold tracking-tight" dir="ltr">
                  SmartManager
                </p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200" dir="ltr">
                  AI Agent
                </p>
              </div>
            </div>
          </div>

          {/* The Agent it opens */}
          <Phone className="absolute end-0 top-0 h-[450px] w-[230px] rotate-[5deg] max-sm:hidden sm:h-[500px] sm:w-[250px]">
            <PhoneAgentBar title="SmartManager AI Agent" online={t("phone.online")} />
            <div className="flex flex-1 flex-col gap-2.5 bg-gradient-to-b from-white to-emerald-50/40 px-3.5 py-4">
              <p className="rounded-2xl rounded-ss-sm bg-slate-100 px-3 py-2 text-[11px] text-slate-800">{t("phone.hello")}</p>
              {MENU.map((m) => (
                <span
                  key={m.key}
                  className="flex items-center gap-2.5 rounded-xl bg-gradient-to-b from-[#13985f] to-[#0b6a47] px-3 py-3 text-[11.5px] font-bold text-white shadow-[0_8px_16px_-10px_rgba(10,106,71,0.8)]"
                >
                  <SiteIcon name={m.icon} size={16} />
                  {t(`phone.menu.${m.key}`)}
                </span>
              ))}
            </div>
          </Phone>
        </div>
      </div>
    </section>
  );
}
