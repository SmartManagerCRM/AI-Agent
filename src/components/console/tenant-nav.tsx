"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Icon, NAV_ICON_PATHS, type NavIconKey } from "@/components/console/icons";
import { useNewOrderCount } from "@/components/notifications/notification-center";

export type NavItem = { key: NavIconKey; href: string; label: string; badge?: string };

export function TenantNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Orders received while the console is open and not yet acknowledged.
  const newOrders = useNewOrderCount();

  return (
    <nav className="flex flex-col gap-0.5 text-sm">
      {items.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.key}
            href={item.href}
            prefetch={false}
            className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors ${
              active ? "bg-emerald-600/15 text-emerald-400" : "text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-3">
              <Icon path={NAV_ICON_PATHS[item.key]} />
              {item.label}
            </span>
            {item.key === "orders" && newOrders > 0 ? (
              <span
                data-testid="nav-new-orders"
                className="animate-pulse rounded-full bg-emerald-500 px-2 py-0.5 text-xs font-semibold text-white"
              >
                {newOrders}
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
