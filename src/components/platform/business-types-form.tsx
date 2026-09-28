"use client";

import { useActionState } from "react";

import { createBusinessTypeAction } from "@/server/platform/business-type-actions";

type Props = { locale: string };

export function CreateBusinessTypeForm({ locale }: Props) {
  const [error, formAction, pending] = useActionState(createBusinessTypeAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Key
        <input
          name="key"
          required
          placeholder="e.g. bakery"
          className="w-32 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Name ({locale})
        <input name="name" required maxLength={80} className="w-40 rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
