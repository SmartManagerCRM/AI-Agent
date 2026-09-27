"use client";

import { useActionState } from "react";

import { createBranchAction } from "@/server/catalog/actions";

type Props = { tenantId: string; slug: string; locale: string };

export function CreateBranchForm({ tenantId, slug, locale }: Props) {
  const [error, formAction, pending] = useActionState(createBranchAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Name
        <input name="name" required maxLength={120} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Phone
        <input name="phone" maxLength={40} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" name="isDefault" />
        Default branch
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add branch
      </button>
    </form>
  );
}
