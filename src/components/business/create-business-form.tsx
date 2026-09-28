"use client";

import { useActionState, useState } from "react";

import { slugify } from "@/lib/slugify";
import { createBusinessAction } from "@/server/business/actions";

type BusinessType = { key: string; name: Record<string, string> };
type Currency = { code: string; name: Record<string, string> };

type Props = {
  locale: string;
  businessTypes: BusinessType[];
  currencies: Currency[];
  labels: {
    businessName: string;
    businessType: string;
    language: string;
    currency: string;
    slug: string;
    submit: string;
  };
};

export function CreateBusinessForm({ locale, businessTypes, currencies, labels }: Props) {
  const [error, formAction, pending] = useActionState(createBusinessAction, undefined);
  // Suggests a slug from the business name as the user types it; once they
  // touch the slug field directly, their own input always wins — this
  // never overwrites a slug they've started editing.
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="defaultLanguage" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        {labels.businessName}
        <input
          name="businessName"
          required
          maxLength={120}
          onChange={(event) => {
            if (!slugTouched) setSlug(slugify(event.target.value));
          }}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.slug}
        <div className="flex items-center gap-1 text-neutral-500">
          <input
            name="slug"
            required
            pattern="[a-z0-9][a-z0-9\-]{0,46}[a-z0-9]?"
            placeholder="my-business"
            value={slug}
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            className="w-full rounded-md border border-neutral-300 px-3 py-2 text-neutral-900"
          />
        </div>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.businessType}
        <select name="businessTypeKey" required className="rounded-md border border-neutral-300 px-3 py-2">
          {businessTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {type.name[locale] ?? type.name.en ?? type.key}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        {labels.currency}
        <select name="currency" required className="rounded-md border border-neutral-300 px-3 py-2">
          {currencies.map((currency) => (
            <option key={currency.code} value={currency.code}>
              {currency.code} — {currency.name[locale] ?? currency.name.en ?? currency.code}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {labels.submit}
      </button>
    </form>
  );
}
