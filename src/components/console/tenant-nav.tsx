"use client";

import { usePathname } from "next/navigation";

import { Icon, NAV_ICON_PATHS, type NavIconKey } from "@/components/console/icons";

export type NavItem = { key: NavIconKey; href: string; label: string; badge?: string };

export function TenantNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <a
            key={item.key}
            href={item.href}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors ${
              active ? "bg-emerald-600/15 text-emerald-400" : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon path={NAV_ICON_PATHS[item.key]} />
              {item.label}
            </span>
            {item.badge && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  item.badge === "New" ? "bg-teal-500/20 text-teal-300" : "bg-slate-700 text-slate-200"
                }`}
              >
                {item.badge}
              </span>
            )}
          </a>
        );
      })}
    </nav>
  );
}
