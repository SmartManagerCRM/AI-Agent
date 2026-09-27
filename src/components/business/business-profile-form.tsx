"use client";

import { useActionState } from "react";

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
};

export function BusinessProfileForm({ tenantId, slug, locale, current }: Props) {
  const [error, formAction, pending] = useActionState(updateBusinessProfileAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        Contact email
        <input
          type="email"
          name="contactEmail"
          defaultValue={current.contact_email ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Contact phone
        <input
          name="contactPhone"
          defaultValue={current.contact_phone ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Website
        <input
          type="url"
          name="websiteUrl"
          placeholder="https://…"
          defaultValue={current.website_url ?? ""}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Timezone
        <input
          name="timezone"
          required
          defaultValue={current.timezone}
          placeholder="e.g. Asia/Riyadh"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Country
        <input name="country" defaultValue={current.country ?? ""} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        City
        <input name="city" defaultValue={current.city ?? ""} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Save
      </button>
    </form>
  );
}
