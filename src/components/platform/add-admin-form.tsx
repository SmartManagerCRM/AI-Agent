"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { addPlatformAdminAction } from "@/server/platform/actions";

type Props = { locale: string };

export function AddAdminForm({ locale }: Props) {
const t = useTranslations("platform.admins");
  const [error, formAction, pending] = useActionState(addPlatformAdminAction, undefined);

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-sm">
        {t("form.email")}
        <input type="email" name="email" required className="rounded-md border border-neutral-300 px-3 py-2" />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {t("form.add")}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
