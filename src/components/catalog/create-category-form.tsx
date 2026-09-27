"use client";

import { useActionState } from "react";

import { createCategoryAction } from "@/server/catalog/actions";

type Props = { tenantId: string; slug: string; locale: string };

export function CreateCategoryForm({ tenantId, slug, locale }: Props) {
  const [error, formAction, pending] = useActionState(createCategoryAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Category name
        <input name="name" required maxLength={120} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-50"
      >
        Add category
      </button>
    </form>
  );
}
