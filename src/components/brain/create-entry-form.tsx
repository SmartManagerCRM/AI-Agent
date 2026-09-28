"use client";

import { useActionState } from "react";

import { createBrainEntryAction } from "@/server/brain/actions";

type Props = { tenantId: string; slug: string; locale: string };

const ENTRY_TYPES = [
  "about",
  "policy",
  "faq",
  "promotion",
  "instruction",
  "terminology",
  "delivery_info",
  "pickup_info",
  "payment_methods",
] as const;

export function CreateEntryForm({ tenantId, slug, locale }: Props) {
  const [error, formAction, pending] = useActionState(createBrainEntryAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select name="entryType" className="rounded-md border border-neutral-300 px-3 py-2">
            {ENTRY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Key
          <input
            name="entryKey"
            required
            placeholder="e.g. delivery-area"
            pattern="[a-z0-9][a-z0-9\-]{0,78}[a-z0-9]?"
            className="rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        Content
        <textarea name="text" required rows={3} maxLength={4000} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Add entry
      </button>
    </form>
  );
}
