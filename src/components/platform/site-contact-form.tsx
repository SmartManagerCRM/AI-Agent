"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { SOCIAL_LABELS, SOCIAL_NETWORKS } from "@/lib/site/social";
import { updateSiteContactAction } from "@/server/platform/actions";

type Props = {
  locale: string;
  current: {
    company_name: string | null;
    company_country: string | null;
    support_email: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    social_links: Record<string, string>;
  };
};

/** The company details the public website shows (footer, Contact, legal pages). Empty = not shown. */
export function SiteContactForm({ locale, current }: Props) {
  const t = useTranslations("platform.settings.site");
  const [message, formAction, pending] = useActionState(updateSiteContactAction, undefined);
  const field = (name: string, label: string, value: string | null, type = "text") => (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      <input name={name} type={type} defaultValue={value ?? ""} maxLength={200} className="rounded-md border border-neutral-300 px-3 py-2" />
    </label>
  );

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="site-contact-form">
      <input type="hidden" name="locale" value={locale} />
      <div className="grid gap-3 sm:grid-cols-2">
        {field("companyName", t("companyName"), current.company_name)}
        {field("companyCountry", t("companyCountry"), current.company_country)}
        {field("supportEmail", t("supportEmail"), current.support_email, "email")}
        {field("contactEmail", t("contactEmail"), current.contact_email, "email")}
        {field("contactPhone", t("contactPhone"), current.contact_phone, "tel")}
      </div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{t("social")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SOCIAL_NETWORKS.map((n) => (
          <label key={n} className="flex flex-col gap-1 text-sm">
            {SOCIAL_LABELS[n]}
            <input
              name={`social_${n}`}
              type="url"
              placeholder="https://…"
              defaultValue={current.social_links[n] ?? ""}
              className="rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-slate-500">{t("hint")}</p>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {t("save")}
        </button>
        {message && <p className="text-sm text-slate-600" role="status">{message}</p>}
      </div>
    </form>
  );
}
