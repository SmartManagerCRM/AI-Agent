import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";

import { MobileMenuButton, MobileSidebarFrame, MobileSidebarProvider } from "@/components/console/mobile-sidebar";
import { Icon, NAV_ICON_PATHS, type NavIconKey } from "@/components/console/icons";
import { PlatformNav } from "@/components/console/platform-nav";
import { NotificationCenter, SoundToggle } from "@/components/notifications/notification-center";
import { PlatformAccountMenu } from "@/components/platform/account-menu";
import { PlatformSearchForm } from "@/components/platform/search-form";
import { signOutAction } from "@/server/auth/actions";
import { notificationLabels } from "@/server/notifications/labels";
import { getPlatformAlerts } from "@/server/platform/dashboard-stats";
import { timed } from "@/server/perf";
import { createUserClient } from "@/server/supabase/clients";
import { currentUser, requireSuperAdmin } from "@/server/tenant/context";

type NavItem = { key: NavIconKey; href: string; label: string };
type NavGroup = { label: string; items: NavItem[] };

export default async function PlatformLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const user = await currentUser();
  const supabase = await createUserClient();

  const [{ data: profile }, alerts] = await timed(
    "layout.superAdmin",
    Promise.all([
      user
        ? supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      getPlatformAlerts(supabase),
    ]),
  );
  const name = profile?.full_name ?? profile?.email ?? user?.email ?? "Super Admin";

  const groups: NavGroup[] = [
    {
      label: "Platform Management",
      items: [
        { key: "dashboard", href: `/${locale}/super-admin`, label: "Dashboard" },
        { key: "customers", href: `/${locale}/super-admin/subscribers`, label: "Subscribers" },
        { key: "building", href: `/${locale}/super-admin/businesses`, label: "Businesses" },
        { key: "bell", href: `/${locale}/super-admin/leads`, label: "Leads" },
        { key: "sparkle", href: `/${locale}/super-admin/analytics`, label: "Analytics" },
        { key: "pulse", href: `/${locale}/super-admin/system-health`, label: "System Health" },
      ],
    },
    {
      label: "Content & Configuration",
      items: [
        { key: "billing", href: `/${locale}/super-admin/plans`, label: "Subscriptions & Plans" },
        { key: "pulse", href: `/${locale}/super-admin/usage`, label: "Usage & AI Cost" },
        { key: "analytics", href: `/${locale}/super-admin/payments`, label: "Payments & Revenue" },
        { key: "agent", href: `/${locale}/super-admin/ai-agents`, label: "AI Agents" },
        { key: "branches", href: `/${locale}/super-admin/business-brain`, label: "Business Brain" },
        { key: "models", href: `/${locale}/super-admin/models`, label: "AI Models" },
        { key: "copy", href: `/${locale}/super-admin/integrations`, label: "Integrations" },
        { key: "settings", href: `/${locale}/super-admin/settings`, label: "Platform Settings" },
      ],
    },
    {
      label: "Access & Security",
      items: [
        { key: "shield", href: `/${locale}/super-admin/admins`, label: "Admin Users" },
        { key: "staff", href: `/${locale}/super-admin/roles`, label: "Roles & Permissions" },
        { key: "audit", href: `/${locale}/super-admin/audit-logs`, label: "Audit Logs" },
        { key: "bell", href: `/${locale}/super-admin/announcements`, label: "Announcements" },
      ],
    },
  ];

  // Super Admin only (requireSuperAdmin above; platform events are also Super-Admin-only in the database).
  const alertLabels = await notificationLabels("platform");

  return (
    <MobileSidebarProvider>
      <NotificationCenter scope={{ kind: "platform" }} locale={locale} labels={alertLabels}>
      <div className="flex min-h-screen bg-slate-50">
        <MobileSidebarFrame>
          <div>
            <div className="mb-4 flex items-center gap-2 px-1">
              <Image src="/brand/logo-mark.png" alt="" width={32} height={32} className="rounded-lg" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">SmartManager</p>
                <p className="text-xs text-slate-400">AI Agent</p>
              </div>
            </div>
            <div className="mb-6 flex items-center gap-1.5 rounded-lg border border-amber-400/30 px-3 py-2 text-xs font-medium text-amber-300">
              <Icon path={NAV_ICON_PATHS.crown} size={14} />
              Super Admin
            </div>
            <PlatformNav groups={groups} />
          </div>
          <div className="flex flex-col gap-1 border-t border-slate-800 pt-4 text-sm">
            <Link
              href={`/${locale}/subscriber`}
              prefetch={false}
              className="rounded-lg px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              Back to console
            </Link>
            <form action={signOutAction}>
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="w-full rounded-lg px-3 py-2 text-start text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                Sign out
              </button>
            </form>
          </div>
        </MobileSidebarFrame>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-16 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <MobileMenuButton />
              <PlatformSearchForm locale={locale} />
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <SoundToggle />
              <PlatformAccountMenu locale={locale} name={name} alerts={alerts} />
            </div>
          </header>
          <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </div>
      </div>
      </NotificationCenter>
    </MobileSidebarProvider>
  );
}
