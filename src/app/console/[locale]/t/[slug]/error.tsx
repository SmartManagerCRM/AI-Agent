"use client";

import { useEffect } from "react";

import { Button } from "@/components/console/button";
import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

/**
 * Catches a render/fetch failure anywhere under this tenant's console
 * (Next.js error boundaries nest — one file here covers every page below
 * it) so a subscriber sees a recoverable screen instead of a blank one.
 * `error.digest` is Next's server-side reference id, safe to show — the
 * raw error message isn't, so it's logged, not displayed.
 */
export default function TenantConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-600">
        <Icon path={NAV_ICON_PATHS.alert} size={24} />
      </span>
      <div className="flex flex-col gap-1">
        <p className="text-lg font-semibold text-slate-900">Something went wrong</p>
        <p className="max-w-sm text-sm text-slate-500">
          This page hit a problem loading your data. It&apos;s usually temporary — try again, and if it keeps happening
          let us know.
        </p>
        {error.digest && <p className="mt-1 font-mono text-xs text-slate-400">Reference: {error.digest}</p>}
      </div>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
