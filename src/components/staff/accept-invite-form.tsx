"use client";

import { useActionState } from "react";

import { acceptInviteAction } from "@/server/staff/actions";

type Props = { token: string; locale: string };

export function AcceptInviteForm({ token, locale }: Props) {
  const [error, formAction, pending] = useActionState(acceptInviteAction, undefined);

  return (
    <form action={formAction} className="flex flex-col items-center gap-2">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="locale" value={locale} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Accept invite
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
