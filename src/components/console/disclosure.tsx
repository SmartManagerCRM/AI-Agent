"use client";

import { useState, type ReactNode } from "react";

/** A section that opens and closes, and stays as the person left it when the page's data refreshes. */
export function Disclosure({ summary, initiallyOpen, children }: { summary: string; initiallyOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details
      className="mt-4 rounded-md border border-slate-100 p-3"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer text-sm font-medium text-slate-700">{summary}</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
