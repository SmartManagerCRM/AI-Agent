"use client";

import { useState } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard API can be unavailable (e.g. insecure context) — the value is already visible/selectable on the page.
        }
      }}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
    >
      <Icon path={copied ? NAV_ICON_PATHS.check : NAV_ICON_PATHS.copy} size={14} />
      {copied ? "Copied" : label}
    </button>
  );
}
