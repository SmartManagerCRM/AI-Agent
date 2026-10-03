"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { updateBusinessProfileAction } from "@/server/business/actions";

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  current: {
    contact_email: string | null;
    contact_phone: string | null;
    website_url: string | null;
    timezone: string;
    country: string | null;
    city: string | null;
  };
  /** Every time zone, from the server (labelled with its UTC offset). */
  timeZones: { value: string; label: string }[];
};

export function BusinessProfileForm({ tenantId, slug, locale, current, timeZones }: Props) {
const t = useTranslations("console.profileForm");
  // A value typed by hand earlier ("UTC+1") isn't a time zone: it stays selectable until a city is chosen.
  const known = timeZones.some((z) => z.value === current.timezone);
  const [error, formAction, pending] = useActionState(updateBusinessProfileAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        {t("email")}
        <input
          type="email"
          name="contactEmail"
          defaultValue={current.contact_email ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("phone")}
        <input
          name="contactPhone"
          defaultValue={current.contact_phone ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("website")}
        <input
          type="url"
          name="websiteUrl"
          placeholder="https://…"
          defaultValue={current.website_url ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("timezone")}
        <select name="timezone" required defaultValue={current.timezone} className="rounded-md border border-neutral-300 px-3 py-2" data-testid="timezone-select">
          {!known && <option value={current.timezone}>{t("chooseCity", { zone: current.timezone })}</option>}
          {timeZones.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-500">{t("tzHint")}</span>
        {!known && (
          <span className="text-xs font-medium text-amber-700">
            {t("tzInvalid", { zone: current.timezone })}
          </span>
        )}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("country")}
        <input name="country" defaultValue={current.country ?? ""} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {t("city")}
        <input name="city" defaultValue={current.city ?? ""} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        {t("save")}
      </Button>
    </form>
  );
}
