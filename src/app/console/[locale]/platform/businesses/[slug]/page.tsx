import { notFound } from "next/navigation";

import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import { getBusinessDetail } from "@/server/platform/business-detail";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const TABS = ["overview", "brain", "agent", "orders", "billing", "activity"] as const;
type TabKey = (typeof TABS)[number];

const STATUS_STYLE: Record<string, string> = {
  onboarding: "bg-amber-50 text-amber-700",
  active: "bg-emerald-50 text-emerald-700",
  suspended: "bg-red-50 text-red-700",
  closed: "bg-slate-100 text-slate-500",
};

function parseTab(value: string | undefined): TabKey {
  return (TABS as readonly string[]).includes(value ?? "") ? (value as TabKey) : "overview";
}

export default async function BusinessDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { locale, slug } = await params;
  const { tab: tabParam } = await searchParams;
  await requireSuperAdmin(locale);
  const tab = parseTab(tabParam);

  const supabase = await createUserClient();
  const detail = await getBusinessDetail(supabase, slug);
  if (!detail) notFound();

  const { data: currencyRow } = await supabase
    .from("currencies")
    .select("exponent")
    .eq("code", detail.tenant.currency)
    .maybeSingle();
  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number, currency?: string | null) =>
    formatMoney(minor, currency ?? detail.tenant.currency, exponent, locale);

  const baseHref = `/${locale}/super-admin/businesses/${slug}`;
  const tabs: Tab[] = [
    { key: "overview", label: "Overview" },
    { key: "brain", label: "Business Brain" },
    { key: "agent", label: "Agent" },
    { key: "orders", label: "Orders" },
    { key: "billing", label: "Subscription & Payments" },
    { key: "activity", label: "Activity" },
  ].map((t) => ({ ...t, href: t.key === "overview" ? baseHref : `${baseHref}?tab=${t.key}`, active: tab === t.key }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{detail.tenant.businessName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            /{detail.tenant.slug} · {detail.tenant.businessTypeLabel}
            {detail.tenant.country && ` · ${detail.tenant.country}`}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[detail.tenant.status]}`}
        >
          {detail.tenant.status}
        </span>
      </div>

      <Tabs tabs={tabs} />

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile icon="orders" accent="emerald" label="Orders" value={String(detail.ordersCount)} trend={null} />
            <KpiTile
              icon="conversations"
              accent="blue"
              label="Conversations"
              value={String(detail.conversationsCount)}
              trend={null}
            />
            <KpiTile
              icon="agent"
              accent="emerald"
              label="Agent"
              value={detail.agent.active ? "Active" : "Inactive"}
              trend={null}
            />
            <KpiTile
              icon="billing"
              accent="orange"
              label="Total paid"
              value={money(detail.paymentSummary.totalPaidMinor, detail.paymentSummary.currency)}
              trend={null}
            />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">Business profile</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="text-slate-500">Owner</dt>
              <dd className="text-slate-900">
                {detail.owner ? `${detail.owner.name}${detail.owner.email ? ` (${detail.owner.email})` : ""}` : "—"}
              </dd>
              <dt className="text-slate-500">Contact</dt>
              <dd className="text-slate-900">{detail.tenant.contactEmail ?? detail.tenant.contactPhone ?? "—"}</dd>
              <dt className="text-slate-500">Website</dt>
              <dd className="text-slate-900">{detail.tenant.websiteUrl ?? "—"}</dd>
              <dt className="text-slate-500">City</dt>
              <dd className="text-slate-900">{detail.tenant.city ?? "—"}</dd>
              <dt className="text-slate-500">Timezone</dt>
              <dd className="text-slate-900">{detail.tenant.timezone}</dd>
              <dt className="text-slate-500">Currency</dt>
              <dd className="text-slate-900">{detail.tenant.currency}</dd>
              <dt className="text-slate-500">Deployment mode</dt>
              <dd className="capitalize text-slate-900">{detail.tenant.deploymentMode.replace(/_/g, " ")}</dd>
              <dt className="text-slate-500">Created</dt>
              <dd className="text-slate-900">{new Date(detail.tenant.createdAt).toLocaleDateString(locale)}</dd>
            </dl>
          </section>
        </div>
      )}

      {tab === "brain" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile
              icon="branches"
              accent="emerald"
              label="Sources"
              value={String(detail.brain.sourceCount)}
              trend={null}
            />
            <KpiTile
              icon="billing"
              accent="orange"
              label="Pending review"
              value={String(detail.brain.pendingReview)}
              trend={null}
            />
            <KpiTile
              icon="orders"
              accent="blue"
              label="Approved entries"
              value={String(detail.brain.approvedEntries)}
              trend={null}
            />
            <KpiTile
              icon="alert"
              accent="purple"
              label="Open conflicts"
              value={String(detail.brain.openConflicts)}
              trend={null}
            />
          </div>
          {detail.brain.sourceCount === 0 && detail.brain.approvedEntries === 0 && (
            <EmptyState
              title="No Business Brain data yet"
              description="This business hasn't added a source or knowledge entry."
            />
          )}
        </div>
      )}

      {tab === "agent" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiTile
            icon="agent"
            accent="emerald"
            label="Status"
            value={detail.agent.active ? "Active" : "Inactive"}
            trend={null}
          />
          <KpiTile
            icon="conversations"
            accent="blue"
            label="Interactions (30d)"
            value={String(detail.agent.interactions30d)}
            trend={null}
          />
          <KpiTile
            icon="analytics"
            accent="purple"
            label="Handled without AI"
            value={`${detail.agent.deterministicPct}%`}
            trend={null}
          />
          <KpiTile
            icon="billing"
            accent="orange"
            label="AI cost (30d)"
            value={`$${detail.agent.costUsd30d.toFixed(4)}`}
            trend={null}
          />
        </div>
      )}

      {tab === "orders" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {detail.recentOrders.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 text-start font-medium">#</th>
                    <th className="py-2 text-start font-medium">Customer</th>
                    <th className="py-2 text-start font-medium">Total</th>
                    <th className="py-2 text-start font-medium">Status</th>
                    <th className="py-2 text-start font-medium">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentOrders.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-medium text-slate-900">#{o.orderNumber}</td>
                      <td className="py-2 text-slate-600">{o.customerName ?? "—"}</td>
                      <td className="py-2 text-slate-600">{money(o.totalMinor)}</td>
                      <td className="py-2 capitalize text-slate-600">{o.status.replace(/_/g, " ")}</td>
                      <td className="py-2 text-slate-500">{new Date(o.createdAt).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No orders yet" description="Orders this business receives will show up here." />
          )}
        </section>
      )}

      {tab === "billing" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {detail.subscription ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">Plan</dt>
              <dd className="text-slate-900">{detail.subscription.planLabel}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd className="capitalize text-slate-900">{detail.subscription.status?.replace("_", " ")}</dd>
              {detail.subscription.trialEndsAt && (
                <>
                  <dt className="text-slate-500">Trial ends</dt>
                  <dd className="text-slate-900">
                    {new Date(detail.subscription.trialEndsAt).toLocaleDateString(locale)}
                  </dd>
                </>
              )}
              {detail.subscription.currentPeriodEnd && (
                <>
                  <dt className="text-slate-500">Renews / expires</dt>
                  <dd className="text-slate-900">
                    {new Date(detail.subscription.currentPeriodEnd).toLocaleDateString(locale)}
                  </dd>
                </>
              )}
              <dt className="text-slate-500">Total paid</dt>
              <dd className="text-slate-900">
                {money(detail.paymentSummary.totalPaidMinor, detail.paymentSummary.currency)}
              </dd>
            </dl>
          ) : (
            <EmptyState title="No subscription" description="This business hasn't subscribed to a plan yet." />
          )}
        </section>
      )}

      {tab === "activity" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {detail.recentActivity.length > 0 ? (
            <ul className="flex flex-col gap-3">
              {detail.recentActivity.map((event) => (
                <li key={event.id} className="text-sm">
                  <p className="text-slate-700">
                    <span className="font-medium capitalize text-slate-900">{event.action.replace(/[._]/g, " ")}</span>
                    {event.actorName && <span className="text-slate-500"> by {event.actorName}</span>}
                  </p>
                  <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString(locale)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No activity yet" description="Actions on this business will show up here." />
          )}
        </section>
      )}
    </div>
  );
}
