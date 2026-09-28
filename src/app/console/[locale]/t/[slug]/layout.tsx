import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { TenantNav, type NavItem } from "@/components/console/tenant-nav";
import { TopHeader } from "@/components/console/top-header";
import { TrialCard } from "@/components/console/trial-card";
import type { Locale } from "@/i18n/locales";
import { daysUntil } from "@/lib/dates";
import { currentUser, isSuperAdmin, myTenantMemberships, requireTenantMember } from "@/server/tenant/context";
import { createUserClient } from "@/server/supabase/clients";

export default async function TenantLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const { tenant, membership } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console");
  const user = await currentUser();
  const supabase = await createUserClient();

  const [showSuperAdminLink, memberships, { data: profile }, { data: subscription }, { count: conversationCount }, { count: openConversationCount }] =
    await Promise.all([
      user ? isSuperAdmin(user.id) : Promise.resolve(false),
      myTenantMemberships(),
      user ? supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("subscriptions").select("status, trial_ends_at, plan_key").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "open"),
    ]);

  const nav: NavItem[] = [
    { key: "dashboard", href: `/${locale}/t/${slug}`, label: t("nav.dashboard") },
    { key: "orders", href: `/${locale}/t/${slug}/orders`, label: t("nav.orders") },
    { key: "products", href: `/${locale}/t/${slug}/products`, label: t("nav.products") },
    { key: "branches", href: `/${locale}/t/${slug}/branches`, label: t("nav.branches") },
    { key: "businessBrain", href: `/${locale}/t/${slug}/brain`, label: t("nav.businessBrain") },
    { key: "agent", href: `/${locale}/t/${slug}/agent`, label: t("nav.agent") },
    { key: "conversations", href: `/${locale}/t/${slug}/conversations`, label: t("nav.conversations") },
    { key: "customers", href: `/${locale}/t/${slug}/customers`, label: t("nav.customers") },
    { key: "billing", href: `/${locale}/t/${slug}/billing`, label: t("nav.billing") },
    { key: "staff", href: `/${locale}/t/${slug}/staff`, label: t("nav.staff") },
    { key: "audit", href: `/${locale}/t/${slug}/audit`, label: t("nav.audit") },
    { key: "settings", href: `/${locale}/t/${slug}/settings`, label: t("nav.settings") },
  ];

  const businessName = tenant.business_name[locale] ?? tenant.slug;
  const userName = profile?.full_name ?? profile?.email ?? user?.email ?? "";
  const otherWorkspaces = memberships
    .filter((m) => m.slug !== slug)
    .map((m) => ({ slug: m.slug, name: m.business_name[locale] ?? m.slug }));

  const daysRemaining =
    subscription?.status === "trialing" && subscription.trial_ends_at ? daysUntil(subscription.trial_ends_at) : null;

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="flex w-60 shrink-0 flex-col justify-between bg-slate-900 px-4 py-6">
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
      </aside>
      <div className="flex flex-1 flex-col">
        <TopHeader
          locale={locale as Locale}
          workspace={{ slug, name: businessName }}
          otherWorkspaces={otherWorkspaces}
          userName={userName}
          roleLabel={membership.role_key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          isSuperAdmin={showSuperAdminLink}
          superAdminLabel={t("superAdminLink")}
          signOutLabel={t("signOut")}
          openConversationCount={openConversationCount ?? 0}
        />
        <main className="flex-1 px-8 py-6">{children}</main>
      </div>
    </div>
  );
}
