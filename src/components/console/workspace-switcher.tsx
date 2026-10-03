"use client";

import Link from "next/link";
import { useState } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

type Workspace = { slug: string; name: string; logoUrl?: string | null };

/** The business's logo beside its name, when it has one. */
function WorkspaceLogo({ url }: { url?: string | null }) {
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- the business's own logo from Storage
  return <img src={url} alt="" className="h-6 w-6 shrink-0 rounded-md object-contain" />;
}

export function WorkspaceSwitcher({
  locale,
  current,
  others,
}: {
  locale: string;
  current: Workspace;
  others: Workspace[];
}) {
  const [open, setOpen] = useState(false);

  if (others.length === 0) {
    return (
      <span className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-900">
        <WorkspaceLogo url={current.logoUrl} />
        <span className="truncate">{current.name}</span>
      </span>
    );
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        <WorkspaceLogo url={current.logoUrl} />
        <span className="truncate">{current.name}</span>
        <Icon path={NAV_ICON_PATHS.chevronDown} size={16} className="shrink-0 text-slate-400" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute start-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {[current, ...others].map((workspace) => (
              <Link
                key={workspace.slug}
                href={`/${locale}/${workspace.slug}`}
                prefetch={false}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 text-sm ${
                  workspace.slug === current.slug
                    ? "bg-emerald-50 font-medium text-emerald-700"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {workspace.name}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
