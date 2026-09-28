import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { MobileSidebarFrame, MobileSidebarProvider } from "@/components/console/mobile-sidebar";
import { TenantNav, type NavItem } from "@/components/console/tenant-nav";
import { TopHeader } from "@/components/console/top-header";
import { TrialCard } from "@/components/console/trial-card";
import type { Locale } from "@/i18n/locales";
import { daysUntil } from "@/lib/dates";
import { currentUser, isSuperAdmin, myTenantMemberships, requireTenantMember } from "@/server/tenant/context";
import { endImpersonationAction } from "@/server/platform/impersonation-actions";
import { createUserClient } from "@/server/supabase/clients";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const { tenant, membership, impersonating } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console");
  const user = await currentUser();
  const supabase = await createUserClient();

  const [
    showSuperAdminLink,
    memberships,
    { data: profile },
    { data: subscription },
    { count: conversationCount },
    { count: openConversationCount },
    { data: announcements },
  ] = await Promise.all([
    user ? isSuperAdmin(user.id) : Promise.resolve(false),
    myTenantMemberships(),
    user
      ? supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("subscriptions").select("status, trial_ends_at, plan_key").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
    supabase
      .from("conversations")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenant.id)
      .eq("status", "open"),
    supabase
      .from("platform_announcements")
      .select("id, message, severity")
      .eq("is_active", true)
      .order("created_at", { ascending: false }),
  ]);

  const nav: NavItem[] = [
    { key: "dashboard", href: `/${locale}/${slug}`, label: t("nav.dashboard") },
    { key: "orders", href: `/${locale}/${slug}/orders`, label: t("nav.orders") },
    { key: "products", href: `/${locale}/${slug}/products`, label: t("nav.products") },
    { key: "branches", href: `/${locale}/${slug}/branches`, label: t("nav.branches") },
    { key: "building", href: `/${locale}/${slug}/tables`, label: t("nav.tables") },
    { key: "businessBrain", href: `/${locale}/${slug}/brain`, label: t("nav.businessBrain") },
    { key: "agent", href: `/${locale}/${slug}/agent`, label: t("nav.agent") },
    { key: "conversations", href: `/${locale}/${slug}/conversations`, label: t("nav.conversations") },
    { key: "customers", href: `/${locale}/${slug}/customers`, label: t("nav.customers") },
    { key: "bell", href: `/${locale}/${slug}/leads`, label: t("nav.leads") },
    { key: "check", href: `/${locale}/${slug}/bookings`, label: t("nav.bookings") },
    { key: "analytics", href: `/${locale}/${slug}/analytics`, label: t("nav.analytics") },
    { key: "marketing", href: `/${locale}/${slug}/marketing`, label: t("nav.marketing") },
    { key: "billing", href: `/${locale}/${slug}/billing`, label: t("nav.billing") },
    { key: "staff", href: `/${locale}/${slug}/staff`, label: t("nav.staff") },
    { key: "audit", href: `/${locale}/${slug}/audit`, label: t("nav.audit") },
    { key: "settings", href: `/${locale}/${slug}/settings`, label: t("nav.settings") },
  ];

  const businessName = tenant.business_name[locale] ?? tenant.slug;
  const userName = profile?.full_name ?? profile?.email ?? user?.email ?? "";
  const otherWorkspaces = memberships
    .filter((m) => m.slug !== slug)
    .map((m) => ({ slug: m.slug, name: m.business_name[locale] ?? m.slug }));

  const daysRemaining =
    subscription?.status === "trialing" && subscription.trial_ends_at ? daysUntil(subscription.trial_ends_at) : null;
  const roleLabel = membership
    ? membership.role_key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Super Admin";

  return (
    <MobileSidebarProvider>
      <div className="flex min-h-screen flex-col">
        {impersonating && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
            <span>
              You&apos;re viewing <strong>{businessName}</strong>&apos;s console as Super Admin — actions you take here
              are real.
            </span>
            <form action={endImpersonationAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="rounded-md bg-amber-950/10 px-3 py-1 text-xs font-semibold hover:bg-amber-950/20"
              >
                Exit
              </button>
            </form>
          </div>
        )}
        {(announcements ?? []).map((a) => (
          <div
            key={a.id}
            className={`px-4 py-2 text-center text-sm font-medium ${
              a.severity === "warning" ? "bg-amber-100 text-amber-900" : "bg-blue-50 text-blue-800"
            }`}
          >
            {a.message}
          </div>
        ))}
        <div className="flex min-h-0 flex-1 bg-slate-50">
          <MobileSidebarFrame>
            <div>
              <div className="mb-6 flex items-center gap-2 px-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                  {businessName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{businessName}</p>
                  <p className="text-xs text-slate-400">SmartManager AI Agent</p>
                </div>
              </div>
              <TenantNav items={nav} />
            </div>
            <div className="mt-6">
              <TrialCard
                locale={locale}
                slug={slug}
                subscription={subscription ? { status: subscription.status, planKey: subscription.plan_key } : null}
                daysRemaining={daysRemaining}
                conversationCount={conversationCount ?? 0}
              />
            </div>
          </MobileSidebarFrame>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopHeader
              locale={locale as Locale}
              workspace={{ slug, name: businessName }}
              otherWorkspaces={otherWorkspaces}
              userName={userName}
              roleLabel={roleLabel}
              isSuperAdmin={showSuperAdminLink}
              superAdminLabel={t("superAdminLink")}
              signOutLabel={t("signOut")}
              openConversationCount={openConversationCount ?? 0}
            />
            <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </div>
    </MobileSidebarProvider>
  );
}
