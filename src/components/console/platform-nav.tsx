"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, NAV_ICON_PATHS, type NavIconKey } from "@/components/console/icons";
import { activeNavHref } from "@/lib/nav-active";

export type PlatformNavGroup = {
  label: string;
  items: { key: NavIconKey; href: string; label: string; count?: { value: number; title: string } }[];
};

/** Super Admin sidebar: the current page is the only one selected. */
export function PlatformNav({ groups }: { groups: PlatformNavGroup[] }) {
  const pathname = usePathname();
  const current = activeNavHref(
    pathname,
    groups.flatMap((group) => group.items.map((item) => item.href)),
  );
  return (
    <nav className="flex flex-col gap-4 text-sm">
      {groups.map((group) => (
        <div key={group.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.href === current;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? "page" : undefined}
                  className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 transition-colors ${
                    active ? "bg-emerald-600/15 text-emerald-400" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  }`}
                >
                  <span className="flex items-center gap-3">
                    <Icon path={NAV_ICON_PATHS[item.key]} size={18} />
                    {item.label}
                  </span>
                  {item.count && item.count.value > 0 && (
                    <span
                      data-testid={`nav-count-${item.href.split("/").pop()}`}
                      title={item.count.title}
                      aria-label={item.count.title}
                      className="min-w-6 rounded-full bg-amber-500 px-2 py-0.5 text-center text-xs font-semibold text-white"
                    >
                      {item.count.value > 99 ? "99+" : item.count.value}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
