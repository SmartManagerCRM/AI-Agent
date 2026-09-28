"use client";

import { useActionState } from "react";

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
    submit: string;
  };
};

// The tenant's console/web address (its slug) is a system-generated
// identifier, not something the subscriber types during onboarding — the
// server derives it from the business name and guarantees it's unique
// (see generateUniqueSlug in src/server/business/actions.ts). It was
// previously a manually-typed field here, labeled "Console URL" in the
// translations, which conflated "pick an identifier" with "type the
// platform's own console address" and led people to type a real URL into
// a lowercase-hyphens-only field.
export function CreateBusinessForm({ locale, businessTypes, currencies, labels }: Props) {
  const [error, formAction, pending] = useActionState(createBusinessAction, undefined);

  return (
    <form action={formAction} className="flex w-full max-w-md flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="defaultLanguage" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        {labels.businessName}
        <input name="businessName" required maxLength={120} className="rounded-md border border-neutral-300 px-3 py-2" />
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
