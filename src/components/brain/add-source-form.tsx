"use client";

import { useActionState } from "react";

import { addWebsiteSourceAction } from "@/server/brain/actions";

type Props = { tenantId: string; slug: string; locale: string };

export function AddSourceForm({ tenantId, slug, locale }: Props) {
  const [error, formAction, pending] = useActionState(addWebsiteSourceAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        Website URL
        <input
          type="url"
          name="url"
          required
          placeholder="https://example.com"
          className="w-72 rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? "Crawling…" : "Add & crawl"}
      </button>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
