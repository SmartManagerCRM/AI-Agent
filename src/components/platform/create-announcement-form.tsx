"use client";

import { useActionState } from "react";

import { createAnnouncementAction } from "@/server/platform/announcement-actions";

type Props = { locale: string };

export function CreateAnnouncementForm({ locale }: Props) {
  const [error, formAction, pending] = useActionState(createAnnouncementAction, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-1 flex-col gap-1 text-sm" style={{ minWidth: 240 }}>
        Message
        <input name="message" required maxLength={500} className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Severity
        <select name="severity" className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="info">Info</option>
          <option value="warning">Warning</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Post
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
