"use client";

import { useActionState } from "react";

import { updatePlatformSettingsAction } from "@/server/platform/actions";

type Props = { locale: string; current: { platform_name: string; maintenance_mode: boolean } };

export function PlatformSettingsForm({ locale, current }: Props) {
  const [error, formAction, pending] = useActionState(updatePlatformSettingsAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3 rounded-md border border-neutral-200 p-4">
      <input type="hidden" name="locale" value={locale} />

      <label className="flex flex-col gap-1 text-sm">
        Platform name
        <input
          name="platformName"
          required
          defaultValue={current.platform_name}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="maintenanceMode" defaultChecked={current.maintenance_mode} />
        Maintenance mode
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-fit rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        Save
      </button>
    </form>
  );
}
