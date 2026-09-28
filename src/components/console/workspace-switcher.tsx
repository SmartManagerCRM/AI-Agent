"use client";

import { useState } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";

type Workspace = { slug: string; name: string };

export function WorkspaceSwitcher({ locale, current, others }: { locale: string; current: Workspace; others: Workspace[] }) {
  const [open, setOpen] = useState(false);

  if (others.length === 0) {
    return (
      <span className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-900">
        {current.name}
      </span>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-slate-50"
      >
        {current.name}
        <Icon path={NAV_ICON_PATHS.chevronDown} size={16} className="text-slate-400" />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="absolute start-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {[current, ...others].map((workspace) => (
              <a
                key={workspace.slug}
                href={`/${locale}/t/${workspace.slug}`}
                className={`block px-3 py-2 text-sm ${
                  workspace.slug === current.slug ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {workspace.name}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
