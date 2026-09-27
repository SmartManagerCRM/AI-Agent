"use client";

import { useActionState } from "react";

import { inviteStaffAction } from "@/server/staff/actions";

type Props = { tenantId: string; locale: string; slug: string };

export function InviteStaffForm({ tenantId, locale, slug }: Props) {
  const [state, formAction, pending] = useActionState(inviteStaffAction, undefined);

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={slug} />
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            name="email"
            required
            placeholder="teammate@example.com"
            className="rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Role
          <select name="roleKey" className="rounded-md border border-neutral-300 px-3 py-2">
            <option value="staff">Staff</option>
            <option value="business_admin">Admin</option>
          </select>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Invite
        </button>
      </form>

      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "inviteLink" in state && (
        <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <p>
            Invite created for <span className="font-medium">{state.email}</span> — send them this link:
          </p>
          <p className="mt-1 break-all font-mono text-xs text-neutral-700">{state.inviteLink}</p>
        </div>
      )}
    </div>
  );
}
