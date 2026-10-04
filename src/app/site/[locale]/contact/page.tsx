import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { SiteIcon, type SiteIconName } from "@/components/site/icons";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/locales";
import { DEMO_AGENT_SLUG } from "@/lib/site/config";
import { pageMetadata } from "@/server/site/metadata";
import { loadSiteInfo } from "@/server/site/public-data";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: "site.contact" });
  return pageMetadata(locale, "/contact", t("metaTitle"), t("subtitle"));
}

/** Contact: the company's details as set in Super Admin → Settings (only those set are shown). */
export default async function ContactPage() {
  const [t, info] = await Promise.all([getTranslations("site.contact"), loadSiteInfo()]);
  const cards: { icon: SiteIconName; label: string; value: string; href?: string; ltr?: boolean }[] = [];
  if (info.supportEmail) cards.push({ icon: "mail", label: t("support"), value: info.supportEmail, href: `mailto:${info.supportEmail}`, ltr: true });
  if (info.contactEmail) cards.push({ icon: "mail", label: t("company"), value: info.contactEmail, href: `mailto:${info.contactEmail}`, ltr: true });
  if (info.contactPhone) cards.push({ icon: "phone", label: t("phone"), value: info.contactPhone, href: `tel:${info.contactPhone.replace(/[^\d+]/g, "")}`, ltr: true });
  if (info.companyCountry) cards.push({ icon: "mapPin", label: t("location"), value: info.companyName ? `${info.companyName} — ${info.companyCountry}` : info.companyCountry });

  return (
    <section className="site-hero-bg">
      <div className="mx-auto max-w-[960px] px-4 py-14 sm:px-6 sm:py-20">
        <h1 className="text-3xl font-extrabold tracking-tight text-[#0c1a33] sm:text-[2.6rem]">{t("title")}</h1>
        <p className="mt-3 max-w-2xl text-lg text-[#33415c]">{t("subtitle")}</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2" data-testid="contact-cards">
          {cards.map((c) => (
            <li key={`${c.label}-${c.value}`} className="site-card flex items-center gap-4 rounded-3xl p-5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <SiteIcon name={c.icon} size={22} />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-slate-500">{c.label}</p>
                {c.href ? (
                  <a href={c.href} className="site-focus block truncate rounded text-base font-bold text-[#0c1a33] hover:text-emerald-700" dir={c.ltr ? "ltr" : undefined}>
                    {c.value}
                  </a>
                ) : (
                  <p className="text-base font-bold text-[#0c1a33]">{c.value}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="site-card mt-8 flex flex-col items-start gap-4 rounded-3xl p-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-extrabold text-[#0c1a33]">{t("demoTitle")}</h2>
            <p className="mt-1 text-[15px] text-[#33415c]">{t("demoText")}</p>
          </div>
          <a href={`/agent/${DEMO_AGENT_SLUG}`} target="_blank" rel="noopener" className="site-btn-primary site-focus h-12 rounded-2xl px-6">
            {t("demoCta")}
            <SiteIcon name="external" size={16} />
          </a>
        </div>
      </div>
    </section>
  );
}
