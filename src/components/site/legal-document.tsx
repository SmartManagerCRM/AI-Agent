import Link from "next/link";
import { getTranslations } from "next-intl/server";

import type { Locale } from "@/i18n/locales";
import type { SiteInfo } from "@/server/site/public-data";

export type LegalDoc = "terms" | "refund" | "privacy" | "about";

/**
 * A text page of the website (Terms, Refund Policy, Privacy Policy, About):
 * its sections come from the messages (site.legal.<doc>.sections), with the
 * company's details as set in Super Admin filled in.
 */
export async function LegalDocument({ locale, doc, info }: { locale: Locale; doc: LegalDoc; info: SiteInfo }) {
  const t = await getTranslations(`site.legal.${doc}`);
  const tc = await getTranslations("site.legal");
  const values = {
    company: info.companyName ?? "Millennium Leaders",
    country: info.companyCountry ?? "",
    supportEmail: info.supportEmail ?? info.contactEmail ?? "",
    contactEmail: info.contactEmail ?? info.supportEmail ?? "",
    phone: info.contactPhone ?? "",
    product: "SmartManager AI Agent",
  };
  const sections = Object.keys(t.raw("sections") as Record<string, unknown>);
  const others = (["terms", "refund", "privacy"] as const).filter((d) => d !== doc);
  const href = { terms: "/terms", refund: "/refund-policy", privacy: "/privacy-policy" } as const;

  return (
    <article className="bg-white">
      <header className="site-hero-bg border-b border-slate-100">
        <div className="mx-auto max-w-[860px] px-4 py-12 sm:px-6 sm:py-16">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-700">{tc("eyebrow")}</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-[#0c1a33] sm:text-[2.6rem]">{t("title")}</h1>
          {doc !== "about" && <p className="mt-3 text-sm text-slate-500">{tc("updated", { date: new Intl.DateTimeFormat(locale, { dateStyle: "long" }).format(new Date("2026-10-05")) })}</p>}
          <p className="mt-5 text-lg leading-relaxed text-[#33415c]">{t("intro", values)}</p>
        </div>
      </header>
      <div className="mx-auto flex max-w-[860px] flex-col gap-8 px-4 py-12 sm:px-6">
        {sections.map((s, i) => (
          <section key={s} aria-labelledby={`${doc}-${s}`}>
            <h2 id={`${doc}-${s}`} className="text-xl font-extrabold text-[#0c1a33]">
              {doc === "about" ? "" : `${i + 1}. `}
              {t(`sections.${s}.title`)}
            </h2>
            <div className="mt-2 flex flex-col gap-3 text-[15px] leading-relaxed text-[#33415c]">
              {t(`sections.${s}.body`, values)
                .split("\n")
                .map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
            </div>
          </section>
        ))}
        {doc !== "about" && (
          <nav aria-label={tc("other")} className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-6 text-sm">
            {others.map((o) => (
              <Link key={o} href={`/${locale}${href[o]}`} className="site-focus rounded-full border border-slate-200 px-4 py-2 font-semibold text-[#0c1a33] hover:bg-slate-50">
                {tc(`links.${o}`)}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </article>
  );
}
