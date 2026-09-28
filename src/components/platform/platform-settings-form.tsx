"use client";

import { useActionState } from "react";

import { updatePlatformSettingsAction } from "@/server/platform/actions";

type Props = {
  locale: string;
  current: { platform_name: string; maintenance_mode: boolean; default_ai_monthly_budget_usd: number | null };
};

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

      <label className="flex flex-col gap-1 text-sm">
        Default AI monthly budget per business (USD)
        <input
          name="defaultAiMonthlyBudgetUsd"
          type="number"
          step="0.01"
          min="0"
          placeholder="No cap"
          defaultValue={current.default_ai_monthly_budget_usd ?? undefined}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-slate-400">
          Leave blank for no cap. Once a business&apos;s AI spend reaches this in a calendar month, its Agent falls back
          to deterministic replies only until the next month — a specific business can also get its own override on its
          Business 360 page.
        </span>
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
