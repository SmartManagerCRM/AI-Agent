"use client";

import { useActionState } from "react";

import { createTableAction } from "@/server/commerce/table-actions";

type Branch = { id: string; name: string };
type Props = { tenantId: string; slug: string; locale: string; branches: Branch[] };

export function CreateTableForm({ tenantId, slug, locale, branches }: Props) {
  const [error, formAction, pending] = useActionState(createTableAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Branch
        <select name="branchId" required className="rounded-md border border-neutral-300 px-3 py-2">
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Table label
        <input
          name="label"
          required
          maxLength={40}
          placeholder="e.g. 12"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending || branches.length === 0}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add table
      </button>
      {branches.length === 0 && <p className="basis-full text-xs text-neutral-400">Add a branch first.</p>}
    </form>
  );
}
