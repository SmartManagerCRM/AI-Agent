"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { Icon, NAV_ICON_PATHS } from "@/components/console/icons";
import { LOCALES, LOCALE_NATIVE_NAMES, type Locale } from "@/i18n/locales";

export function LocaleSwitcher({ locale }: { locale: Locale }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const targetPath = (target: Locale) => {
    if (!pathname) return `/${target}`;
    const segments = pathname.split("/");
    segments[1] = target;
    return segments.join("/");
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100"
      >
        {locale.toUpperCase()}
        <Icon path={NAV_ICON_PATHS.chevronDown} size={14} />
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} aria-label="Close menu" />
          <div className="absolute end-0 z-20 mt-2 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
            {LOCALES.map((target) => (
              <a
                key={target}
                href={targetPath(target)}
                className={`block px-3 py-2 text-sm ${
                  target === locale ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {LOCALE_NATIVE_NAMES[target]}
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
