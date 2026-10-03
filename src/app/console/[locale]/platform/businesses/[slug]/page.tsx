import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Tabs, type Tab } from "@/components/console/tabs";
import { formatMoney } from "@/lib/money";
import { setTenantAiBudgetAction } from "@/server/platform/actions";
import { endImpersonationAction, startImpersonationAction } from "@/server/platform/impersonation-actions";
import { SubscriberUsageOverridesForm } from "@/components/platform/usage-limits-forms";
import { getBusinessDetail } from "@/server/platform/business-detail";
import { loadPlatformUsage } from "@/server/platform/usage";
import { USAGE_STATE_STYLE, type SubscriberUsageRow } from "@/server/platform/usage-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const TABS = ["overview", "brain", "agent", "usage", "orders", "billing", "activity"] as const;
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
  const admin = await requireSuperAdmin(locale);
  const tab = parseTab(tabParam);

  const supabase = await createUserClient();
  const detail = await getBusinessDetail(supabase, slug);
  if (!detail) notFound();

  const { data: activeGrant } = await supabase
    .from("super_admin_impersonations")
    .select("expires_at")
    .eq("admin_user_id", admin.id)
    .eq("tenant_id", detail.tenant.id)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const { data: currencyRow } = await supabase
    .from("currencies")
    .select("exponent")
    .eq("code", detail.tenant.currency)
    .maybeSingle();
  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number, currency?: string | null) =>
    formatMoney(minor, currency ?? detail.tenant.currency, exponent, locale);

  const usage = tab === "usage" ? ((await loadPlatformUsage(supabase, detail.tenant.id))[0] ?? null) : null;

  const baseHref = `/${locale}/super-admin/businesses/${slug}`;
  const tabs: Tab[] = [
    { key: "overview", label: "Overview" },
    { key: "brain", label: "Business Brain" },
    { key: "agent", label: "Agent" },
    { key: "usage", label: "Usage Limits" },
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
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium capitalize ${STATUS_STYLE[detail.tenant.status]}`}
          >
            {detail.tenant.status}
          </span>
          <Link
            href={`/${locale}/super-admin/subscribers/${slug}`}
            prefetch={false}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            Edit subscriber
          </Link>
          {activeGrant ? (
            <div className="flex items-center gap-2">
              <Link
                href={`/${locale}/${slug}`}
                prefetch={false}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Continue in console
              </Link>
              <form action={endImpersonationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
                  End access
                </button>
              </form>
            </div>
          ) : (
            <form action={startImpersonationAction}>
              <input type="hidden" name="tenantId" value={detail.tenant.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="locale" value={locale} />
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                Enter as support
              </button>
            </form>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} />

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile icon="orders" accent="emerald" label="Orders" value={String(detail.ordersCount)} trend={null} href={`${baseHref}?tab=orders`} />
            <KpiTile
              icon="conversations"
              accent="blue"
              label="Conversations"
              value={String(detail.conversationsCount)}
              trend={null}
          href={`${baseHref}?tab=agent`}
        />
            <KpiTile
              icon="agent"
              accent="emerald"
              label="Agent"
              value={detail.agent.active ? "Active" : "Inactive"}
              trend={null}
          href={`${baseHref}?tab=agent`}
        />
            <KpiTile
              icon="billing"
              accent="orange"
              label="Total paid"
              value={money(detail.paymentSummary.totalPaidMinor, detail.paymentSummary.currency)}
              trend={null}
          href={`${baseHref}?tab=billing`}
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
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="billing"
              accent="orange"
              label="Pending review"
              value={String(detail.brain.pendingReview)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="orders"
              accent="blue"
              label="Approved entries"
              value={String(detail.brain.approvedEntries)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="alert"
              accent="purple"
              label="Open conflicts"
              value={String(detail.brain.openConflicts)}
              trend={null}
          href={`${baseHref}?tab=brain`}
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
          href={`/${locale}/super-admin/subscribers/${slug}`}
        />
          <KpiTile
            icon="conversations"
            accent="blue"
            label="Interactions (30d)"
            value={String(detail.agent.interactions30d)}
            trend={null}
          href={`${baseHref}?tab=agent`}
        />
          <KpiTile
            icon="analytics"
            accent="purple"
            label="Handled without AI"
            value={`${detail.agent.deterministicPct}%`}
            trend={null}
          href={`${baseHref}?tab=agent`}
        />
          <KpiTile
            icon="billing"
            accent="orange"
            label="AI cost (30d)"
            value={`$${detail.agent.costUsd30d.toFixed(4)}`}
            trend={null}
          href={`${baseHref}?tab=usage`}
        />
        </div>
      )}

      {tab === "agent" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">AI Cost Guard</h2>
          <p className="mb-3 text-xs text-slate-500">
            {detail.costGuard.budgetUsd !== null
              ? `Spent $${detail.costGuard.spentUsd.toFixed(2)} of $${detail.costGuard.budgetUsd.toFixed(2)} this calendar month${
                  detail.costGuard.exceeded
                    ? " — budget reached, the Agent is falling back to deterministic replies only."
                    : "."
                }`
              : `Spent $${detail.costGuard.spentUsd.toFixed(2)} this calendar month — no budget set, no cap.`}
          </p>
          <form action={setTenantAiBudgetAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={detail.tenant.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <label className="flex flex-col gap-1 text-sm">
              Override budget (USD / month)
              <input
                name="budgetUsd"
                type="number"
                step="0.01"
                min="0"
                placeholder="Use platform default"
                defaultValue={detail.costGuard.tenantOverrideUsd ?? undefined}
                className="w-40 rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save
            </button>
          </form>
        </section>
      )}

      {tab === "usage" &&
        (usage ? (
          <UsageLimitsSection usage={usage} locale={locale} slug={slug} />
        ) : (
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <EmptyState
              title="No subscription"
              description="Usage limits apply once this business has a subscription."
            />
          </section>
        ))}

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

const usd = (v: number | null, digits = 2) => (v === null ? "—" : `$${v.toFixed(digits)}`);

/** Super Admin only: this period's conversation and AI-cost usage, plan defaults vs overrides. */
function UsageLimitsSection({ usage, locale, slug }: { usage: SubscriberUsageRow; locale: string; slug: string }) {
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "—";
  const aiRemaining = usage.aiCostLimit !== null ? Math.max(0, usage.aiCostLimit - usage.aiCostUsed) : null;
  const convRemaining =
    usage.conversationLimit !== null ? Math.max(0, usage.conversationLimit - usage.conversationsUsed) : null;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">Usage Limits</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${USAGE_STATE_STYLE[usage.usageState]}`}>
          {usage.usageState.replace(/_/g, " ")}
        </span>
      </div>
      {usage.isTrial ? (
        <p className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">
          Free trial — it ends on {date(usage.periodEnd)}, after {usage.conversationLimit?.toLocaleString(locale) ?? "∞"}{" "}
          conversations, or once its {usd(usage.aiCostLimit)} AI allowance is used, whichever comes first
          {usage.trialEnded && ` (ended: ${usage.trialEndReason?.replace(/_/g, " ")})`}. Trial limits are set on Usage &amp;
          AI Cost; the overrides below apply to paid billing periods.
        </p>
      ) : (
        !usage.isPaid && (
          <p className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">
            Not on a paid billing period ({usage.status}). The paid-plan limits below apply only while the subscription
            is active and paid.
          </p>
        )
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <dt className="text-slate-500">Plan</dt>
        <dd className="capitalize text-slate-900">{usage.planKey}</dd>
        <dt className="text-slate-500">{usage.isTrial ? "Trial period" : "Billing period"}</dt>
        <dd className="text-slate-900">
          {date(usage.periodStart)} → {date(usage.periodEnd)}
          {!usage.isTrial && ` (resets ${date(usage.periodEnd)})`}
        </dd>
        <dt className="text-slate-500">Conversations</dt>
        <dd className="text-slate-900">
          {usage.conversationsUsed.toLocaleString(locale)} /{" "}
          {usage.conversationLimit?.toLocaleString(locale) ?? "no limit"}
          {usage.conversationPercent !== null && ` (${usage.conversationPercent}%)`}
          {convRemaining !== null && ` · ${convRemaining.toLocaleString(locale)} remaining`}
        </dd>
        {usage.graceUntil && (
          <>
            <dt className="text-slate-500">Grace period until</dt>
            <dd className="text-slate-900">{new Date(usage.graceUntil).toLocaleString(locale)}</dd>
          </>
        )}
        <dt className="text-slate-500">{usage.isTrial ? "AI cost (against the trial allowance)" : "AI cost (counted against the cap)"}</dt>
        <dd className="text-slate-900">
          {usd(usage.aiCostUsed, 4)} / {usd(usage.aiCostLimit)}
          {usage.aiCostPercent !== null && ` (${usage.aiCostPercent}%)`}
          {aiRemaining !== null && ` · ${usd(aiRemaining, 4)} remaining`}
          {usage.aiCostReserved > 0 && ` · ${usd(usage.aiCostReserved, 4)} in flight`}
        </dd>
        <dt className="text-slate-500">Agent AI cost this period (all calls)</dt>
        <dd className="text-slate-900">
          {usd(usage.agentAiCost, 4)} · {usage.agentAiResponses.toLocaleString(locale)} AI responses
        </dd>
        <dt className="text-slate-500">Premium voice this period (ElevenLabs — not part of the AI cost cap)</dt>
        <dd className="text-slate-900">
          {usd(usage.agentVoiceCost, 4)} · {usage.agentVoiceClips.toLocaleString(locale)} clips generated ·{" "}
          {usage.agentVoiceCharacters.toLocaleString(locale)} characters
        </dd>
        <dt className="text-slate-500">Business Brain AI cost (tracked separately)</dt>
        <dd className="text-slate-900">
          {usd(usage.brainAiCost, 4)} this period · {usd(usage.brainAiCostTotal, 4)} all time
        </dd>
      </dl>

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Limits</p>
        <p className="mb-3 text-xs text-slate-500">
          Plan defaults: {usage.conversationLimitDefault?.toLocaleString(locale) ?? "no limit"} conversations,{" "}
          {usd(usage.aiCostLimitDefault)} AI cost. Effective:{" "}
          {usage.conversationLimit?.toLocaleString(locale) ?? "no limit"} conversations, {usd(usage.aiCostLimit)} AI
          cost. Leave a field empty to use the plan default.
        </p>
        <SubscriberUsageOverridesForm
          locale={locale}
          tenantId={usage.tenantId}
          slug={slug}
          conversationLimitOverride={usage.conversationLimitOverride}
          aiCostLimitOverride={usage.aiCostLimitOverride}
          conversationLimitDefault={usage.conversationLimitDefault}
          aiCostLimitDefault={usage.aiCostLimitDefault}
        />
      </div>
    </section>
  );
}
