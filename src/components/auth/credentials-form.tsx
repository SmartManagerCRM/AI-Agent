"use client";

import { useActionState } from "react";

type Props = {
  action: (prevState: string | undefined, formData: FormData) => Promise<string | undefined>;
  locale: string;
  emailLabel: string;
  passwordLabel: string;
  submitLabel: string;
  /** Where to send the user after auth succeeds (e.g. back to an invite link) — validated server-side, never followed blindly. */
  redirectTo?: string;
};

export function CredentialsForm({ action, locale, emailLabel, passwordLabel, submitLabel, redirectTo }: Props) {
  const [error, formAction, pending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex w-full max-w-sm flex-col gap-4">
      <input type="hidden" name="locale" value={locale} />
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <label className="flex flex-col gap-1 text-sm">
        {emailLabel}
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {passwordLabel}
        <input
          type="password"
          name="password"
          required
          minLength={8}
          autoComplete="current-password"
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitLabel}
      </button>
    </form>
  );
}
