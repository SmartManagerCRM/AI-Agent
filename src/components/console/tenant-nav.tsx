"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, NAV_ICON_PATHS, type NavIconKey } from "@/components/console/icons";
import { useNewOrderCount } from "@/components/notifications/notification-center";
import { activeNavHref } from "@/lib/nav-active";

/** Things on a page still waiting for the business (open orders, bookings not yet fulfilled). */
export type NavCount = { value: number; title: string; urgent?: boolean };
export type NavItem = { key: NavIconKey; href: string; label: string; badge?: string; count?: NavCount };

export function TenantNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Orders received while the console is open and not yet acknowledged.
  const newOrders = useNewOrderCount();
  const current = activeNavHref(pathname, items.map((item) => item.href));

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      {items.map((item) => {
        const active = item.href === current;
        // Orders received while the console is open count at once, before the page's numbers refresh.
        const waiting = item.key === "orders" ? Math.max(item.count?.value ?? 0, newOrders) : (item.count?.value ?? 0);
        const fresh = item.key === "orders" ? newOrders > 0 : (item.count?.urgent ?? false);
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch={false}
            aria-current={active ? "page" : undefined}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors ${
              active ? "bg-emerald-600/15 text-emerald-400" : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon path={NAV_ICON_PATHS[item.key]} />
              {item.label}
            </span>
            {waiting > 0 ? (
              <span
                data-testid={item.key === "orders" && newOrders > 0 ? "nav-new-orders" : `nav-count-${item.key}`}
                title={item.count?.title}
                aria-label={item.count?.title}
                className={`min-w-6 rounded-full px-2 py-0.5 text-center text-xs font-semibold text-white ${
                  fresh ? "animate-pulse bg-emerald-500" : "bg-amber-500"
                }`}
              >
                {waiting > 99 ? "99+" : waiting}
              </span>
            ) : item.badge && (
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  item.badge === "New" ? "bg-teal-500/20 text-teal-300" : "bg-slate-700 text-slate-200"
                }`}
              >
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
