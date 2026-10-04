import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import { SECTION_IDS } from "@/lib/site/config";
import { SOCIAL_LABELS, socialLinks } from "@/lib/site/social";
import type { SiteInfo } from "@/server/site/public-data";

import { SiteIcon } from "./icons";
import { SiteLogo } from "./site-header";

/** The website's footer: what SmartManager AI Agent is, contact details (as set in Super Admin), and every page. */
export async function SiteFooter({ locale, info }: { locale: Locale; info: SiteInfo }) {
  const t = await getTranslations("site.footer");
  const company = info.companyName ?? "Millennium Leaders";
  const columns = [
    {
      title: t("company"),
      links: [
        { href: `/${locale}/about`, label: t("about") },
        { href: `/${locale}/contact`, label: t("contact") },
        { href: `/${locale}#${SECTION_IDS.faq}`, label: t("faq") },
      ],
    },
    {
      title: t("product"),
      links: [
        { href: `/${locale}#${SECTION_IDS.features}`, label: t("features") },
        { href: `/${locale}#${SECTION_IDS.howItWorks}`, label: t("howItWorks") },
        { href: `/${locale}/pricing`, label: t("pricing") },
      ],
    },
    {
      title: t("legal"),
      links: [
        { href: `/${locale}/terms`, label: t("terms") },
        { href: `/${locale}/refund-policy`, label: t("refund") },
        { href: `/${locale}/privacy-policy`, label: t("privacy") },
      ],
    },
  ];
  const social = socialLinks(info.socialLinks);

  return (
    <footer className="border-t border-slate-200 bg-[#0b1830] text-slate-300" data-testid="site-footer">
      <div className="mx-auto grid max-w-[1240px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.4fr_1.1fr_repeat(3,0.8fr)] lg:px-8">
        <div className="flex flex-col gap-4">
          <div className="w-fit rounded-2xl bg-white px-3 py-2">
            <SiteLogo locale={locale} compact />
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-slate-400">{t("description")}</p>
          {social.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label={t("social")}>
              {social.map((s) => (
                <li key={s.network}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer" className="site-focus rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10">
                    {SOCIAL_LABELS[s.network]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white">{t("contactTitle")}</h2>
          <ul className="flex flex-col gap-2.5 text-sm">
            {[info.supportEmail, info.contactEmail]
              .filter((e): e is string => !!e)
              .map((email) => (
                <li key={email}>
                  <a href={`mailto:${email}`} className="site-focus flex items-center gap-2 rounded hover:text-white" dir="ltr">
                    <SiteIcon name="mail" size={16} className="text-emerald-400" />
                    {email}
                  </a>
                </li>
              ))}
            {info.contactPhone && (
              <li>
                <a href={`tel:${info.contactPhone.replace(/[^\d+]/g, "")}`} className="site-focus flex items-center gap-2 rounded hover:text-white">
                  <SiteIcon name="phone" size={16} className="text-emerald-400" />
                  <span dir="ltr">{info.contactPhone}</span>
                </a>
              </li>
            )}
            {info.companyCountry && (
              <li className="flex items-center gap-2">
                <SiteIcon name="mapPin" size={16} className="text-emerald-400" />
                {t("country", { country: info.companyCountry })}
              </li>
            )}
          </ul>
        </div>

        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title} className="flex flex-col gap-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-white">{col.title}</h2>
            <ul className="flex flex-col gap-2.5 text-sm">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="site-focus rounded hover:text-white">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-1 px-4 py-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <p>{t("copyright", { year: new Date().getFullYear() })}</p>
          <p>{t("attribution", { company })}</p>
        </div>
      </div>
    </footer>
  );
}
