import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";

import { MobileSidebarFrame, MobileSidebarProvider } from "@/components/console/mobile-sidebar";
import { NotificationCenter } from "@/components/notifications/notification-center";
import { ReceiptPrintHost } from "@/components/receipts/receipt-print-host";
import { TenantNav, type NavItem } from "@/components/console/tenant-nav";
import { CurrencyBar } from "@/components/console/currency-bar";
import { TopHeader } from "@/components/console/top-header";
import { TrialCard } from "@/components/console/trial-card";
import { loadSubscriberUsage } from "@/server/billing/usage-summary";
import type { Locale } from "@/i18n/locales";
import { MENA_CURRENCIES } from "@/lib/currencies";
import { daysUntil } from "@/lib/dates";
import { currentUser, isSuperAdmin, myTenantMemberships, requireTenantMember } from "@/server/tenant/context";
import { loadDeploymentStatus } from "@/server/agent-public/go-live";
import { publicAgentUrls } from "@/server/agent-public/urls";
import { endImpersonationAction } from "@/server/platform/impersonation-actions";
import { timed } from "@/server/perf";
import { notificationLabels } from "@/server/notifications/labels";
import { productImageUrl } from "@/lib/product-image";
import { newConversationCount } from "@/server/inbox/count";
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
  const tShell = await getTranslations("console.shell");
  const tCommon = await getTranslations("common");
  const user = await currentUser();
  const supabase = await createUserClient();
  // Still waiting for the business: orders received but not yet completed, and bookings not yet fulfilled
  // (requests to answer and confirmed bookings not yet completed). Counted in Postgres, under the member's own
  // RLS — someone who can't see orders or bookings gets no number.
  const waitingCounts = Promise.all([
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).in("status", ["paid", "confirmed", "preparing", "ready"]),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).in("status", ["pending", "confirmed"]),
    supabase.from("bookings").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("status", "pending"),
  ]);

  const [
    showSuperAdminLink,
    memberships,
    { data: profile },
    { data: subscription },
    { count: conversationCount },
    newConversations,
    { data: announcements },
    deploymentStatus,
    { data: currencies },
    { data: roleGrants },
    { data: receiptSettings },
  ] = await timed(
    "layout.tenant",
    Promise.all([
      user ? isSuperAdmin(user.id) : Promise.resolve(false),
      myTenantMemberships(),
      user
        ? supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from("subscriptions").select("status, trial_ends_at, plan_key").eq("tenant_id", tenant.id).maybeSingle(),
      supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id),
      newConversationCount(supabase, tenant.id, user?.id ?? null),
      supabase
        .from("platform_announcements")
        .select("id, message, message_translations, severity")
        .eq("is_active", true)
        .order("created_at", { ascending: false }),
      loadDeploymentStatus(supabase, tenant.id),
      supabase.from("currencies").select("code, name").order("code"),
      // May this member change the business currency (settings.write)? The database checks it again.
      membership
        ? supabase
            .from("roles")
            .select("id, role_permissions!inner(permission_key)")
            .eq("key", membership.role_key)
            .eq("role_permissions.permission_key", "settings.write")
        : Promise.resolve({ data: null }),
      // Receipts print on a click, or as soon as an order is confirmed.
      supabase.from("tenant_settings").select("receipt_print_mode").eq("tenant_id", tenant.id).maybeSingle(),
    ]),
  );
  const canChangeCurrency = impersonating || (roleGrants ?? []).length > 0;
  const currencyOptions = (currencies ?? []).map((c) => ({
    code: c.code,
    name: c.name[locale] ?? c.name.en ?? c.code,
    mena: MENA_CURRENCIES.has(c.code),
  }));
  const isLive = deploymentStatus === "published";
  // Paid plans have a monthly conversation limit; the free trial its own.
  const usage =
    subscription?.status === "active" || subscription?.status === "trialing"
      ? await loadSubscriberUsage(supabase, tenant.id)
      : null;

  const [{ count: openOrders }, { count: openBookings }, { count: bookingRequests }] = await waitingCounts;
  const nav: NavItem[] = [
    { key: "dashboard", href: `/${locale}/${slug}`, label: t("nav.dashboard") },
    {
      key: "orders",
      href: `/${locale}/${slug}/orders`,
      label: t("nav.orders"),
      count: { value: openOrders ?? 0, title: tShell("openOrders", { count: openOrders ?? 0 }) },
    },
    { key: "products", href: `/${locale}/${slug}/products`, label: t("nav.products") },
    { key: "branches", href: `/${locale}/${slug}/branches`, label: t("nav.branches") },
    { key: "building", href: `/${locale}/${slug}/tables`, label: t("nav.tables") },
    { key: "businessBrain", href: `/${locale}/${slug}/brain`, label: t("nav.businessBrain") },
    { key: "agent", href: `/${locale}/${slug}/agent`, label: t("nav.agent") },
    { key: "conversations", href: `/${locale}/${slug}/conversations`, label: t("nav.conversations") },
    { key: "customers", href: `/${locale}/${slug}/customers`, label: t("nav.customers") },
    { key: "bell", href: `/${locale}/${slug}/leads`, label: t("nav.leads") },
    {
      key: "check",
      href: `/${locale}/${slug}/bookings`,
      label: t("nav.bookings"),
      count: {
        value: openBookings ?? 0,
        urgent: (bookingRequests ?? 0) > 0,
        title: [
          bookingRequests ? tShell("bookingRequests", { count: bookingRequests }) : null,
          tShell("confirmedBookings", { count: (openBookings ?? 0) - (bookingRequests ?? 0) }),
        ]
          .filter(Boolean)
          .join(" · "),
      },
    },
    { key: "membership", href: `/${locale}/${slug}/memberships`, label: t("nav.memberships") },
    { key: "analytics", href: `/${locale}/${slug}/analytics`, label: t("nav.analytics") },
    { key: "marketing", href: `/${locale}/${slug}/marketing`, label: t("nav.marketing") },
    { key: "billing", href: `/${locale}/${slug}/billing`, label: t("nav.billing") },
    { key: "staff", href: `/${locale}/${slug}/staff`, label: t("nav.staff") },
    { key: "audit", href: `/${locale}/${slug}/audit`, label: t("nav.audit") },
    { key: "settings", href: `/${locale}/${slug}/settings`, label: t("nav.settings") },
  ];

  const businessName = tenant.business_name[locale] ?? tenant.slug;
  const logoUrl = productImageUrl(tenant.logo_path);
  const userName = profile?.full_name ?? profile?.email ?? user?.email ?? "";
  const otherWorkspaces = memberships
    .filter((m) => m.slug !== slug)
    .map((m) => ({ slug: m.slug, name: m.business_name[locale] ?? m.slug }));

  const daysRemaining =
    subscription?.status === "trialing" && subscription.trial_ends_at ? daysUntil(subscription.trial_ends_at) : null;
  const roleLabel = membership
    ? tCommon.has(`role.${membership.role_key}`)
      ? tCommon(`role.${membership.role_key}`)
      : membership.role_key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : tCommon("role.super_admin");

  const alertLabels = await notificationLabels("orders");

  return (
    <MobileSidebarProvider>
      <NotificationCenter
        scope={{ kind: "tenant", tenantId: tenant.id }}
        locale={locale}
        slug={slug}
        labels={alertLabels}
        selfUserId={user?.id}
      >
      <ReceiptPrintHost slug={slug} locale={locale} autoPrint={receiptSettings?.receipt_print_mode === "auto"} />
      <div className="flex min-h-screen flex-col">
        {impersonating && (
          <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
            <span>{tShell.rich("impersonating", { business: businessName, strong: (c) => <strong>{c}</strong> })}</span>
            <form action={endImpersonationAction}>
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="rounded-md bg-amber-950/10 px-3 py-1 text-xs font-semibold hover:bg-amber-950/20"
              >
                {tShell("exit")}
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
            {a.message_translations[locale] ?? a.message}
          </div>
        ))}
        <div className="flex min-h-0 flex-1 bg-slate-50">
          <MobileSidebarFrame name="tenant">
            <div>
              <div className="mb-6 flex items-center gap-2 px-1">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the business's own logo from Storage
                  <img src={logoUrl} alt="" data-testid="sidebar-logo" className="h-9 w-9 shrink-0 rounded-lg bg-white object-contain p-0.5" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                    {businessName.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{businessName}</p>
                  <p className="text-xs text-slate-400">SmartManager AI Agent</p>
                </div>
              </div>
              {/* Deployment status (Go live), not Brain readiness. */}
              <div className="mb-4 flex items-center justify-between gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs" data-testid="sidebar-live-status">
                <span className={`font-semibold ${isLive ? "text-emerald-400" : deploymentStatus === "paused" ? "text-amber-300" : "text-slate-300"}`}>
                  {isLive ? tShell("live") : deploymentStatus === "paused" ? tShell("paused") : tShell("notLive")}
                </span>
                {isLive ? (
                  <a href={publicAgentUrls().agent(tenant.slug)} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-300 hover:underline">
                    {tShell("openAgent")}
                  </a>
                ) : (
                  <a href={`/${locale}/${slug}/brain#go-live`} className="rounded-md bg-emerald-600 px-2 py-1 font-medium text-white hover:bg-emerald-500">
                    {tShell("goLive")}
                  </a>
                )}
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
                usage={
                  (usage?.isPaid || usage?.isTrial) && usage.conversationLimit !== null
                    ? {
                        used: usage.conversationsUsed,
                        limit: usage.conversationLimit,
                        warningLevel: usage.warningLevel,
                        limited: usage.conversationState === "blocked" || usage.aiLimited,
                        inGrace: usage.conversationState === "grace",
                        trialEnded: usage.trialEnded,
                      }
                    : null
                }
              />
            </div>
          </MobileSidebarFrame>
          <div className="flex min-w-0 flex-1 flex-col">
            <TopHeader
              locale={locale as Locale}
              workspace={{ slug, name: businessName, logoUrl }}
              otherWorkspaces={otherWorkspaces}
              userName={userName}
              roleLabel={roleLabel}
              isSuperAdmin={showSuperAdminLink}
              superAdminLabel={t("superAdminLink")}
              signOutLabel={t("signOut")}
              newConversationCount={newConversations}
              currencyBar={
                <CurrencyBar
                  current={tenant.currency}
                  options={currencyOptions}
                  canChange={canChangeCurrency}
                  locale={locale}
                  slug={slug}
                />
              }
            />
            <main className="flex-1 overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8">{children}</main>
          </div>
        </div>
      </div>
      </NotificationCenter>
    </MobileSidebarProvider>
  );
}
