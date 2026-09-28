"use client";

import { useState } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { signOutAction } from "@/server/auth/actions";

type Props = {
  locale: string;
  name: string;
  roleLabel: string;
  initial: string;
  isSuperAdmin: boolean;
  superAdminLabel: string;
  signOutLabel: string;
};

export function AccountMenu({ locale, name, roleLabel, initial, isSuperAdmin, superAdminLabel, signOutLabel }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-2 rounded-full py-1 pe-2 ps-1 hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-sm font-semibold text-white">
          {initial}
        </span>
        <span className="hidden text-start sm:block">
          <span className="block text-sm font-medium text-slate-900">{name}</span>
          <span className="block text-xs text-slate-500">{roleLabel}</span>
        </span>
        <Icon path={NAV_ICON_PATHS.chevronDown} size={16} className="text-slate-400" />
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          />
          <div className="absolute end-0 z-20 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            <div className="border-b border-slate-100 px-3 py-2">
              <p className="text-sm font-medium text-slate-900">{name}</p>
              <p className="text-xs text-slate-500">{roleLabel}</p>
            </div>
            {isSuperAdmin && (
              <a
                href={`/${locale}/super-admin`}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Icon path={NAV_ICON_PATHS.shield} size={16} />
                {superAdminLabel}
              </a>
            )}
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="w-full px-3 py-2 text-start text-sm text-slate-700 hover:bg-slate-50">
                {signOutLabel}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
