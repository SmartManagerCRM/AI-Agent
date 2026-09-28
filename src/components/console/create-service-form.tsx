"use client";

import { useActionState } from "react";

import { createServiceAction } from "@/server/booking/actions";

type Props = { tenantId: string; slug: string; locale: string; currencyExponent: number };

export function CreateServiceForm({ tenantId, slug, locale, currencyExponent }: Props) {
  const [error, formAction, pending] = useActionState(createServiceAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="currencyExponent" value={currencyExponent} />
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" required maxLength={160} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Duration (min)
        <input
          name="durationMinutes"
          type="number"
          min={1}
          max={480}
          required
          defaultValue={30}
          className="w-24 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Price (optional)
        <input
          name="priceMajor"
          type="number"
          step={1 / 10 ** currencyExponent}
          min={0}
          className="w-28 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add service
      </button>
    </form>
  );
}
