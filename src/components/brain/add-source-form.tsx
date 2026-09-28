"use client";

import { useActionState } from "react";

import { Button } from "@/components/console/button";
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
      <Button type="submit" disabled={pending}>
        {pending ? "Crawling…" : "Add & crawl"}
      </Button>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
