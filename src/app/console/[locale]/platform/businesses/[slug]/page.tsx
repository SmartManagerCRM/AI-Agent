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
import { useTranslations } from "next-intl";
import { getTranslations } from "next-intl/server";
import { auditActionLabel, statusLabel } from "@/lib/i18n-labels";

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
  const t = await getTranslations("platform.business360");
  const tAll = await getTranslations();
  const detail = await getBusinessDetail(supabase, slug, locale);
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
  const tabs: Tab[] = TABS.map((key) => ({
    key,
    label: t(`tab.${key}`),
    href: key === "overview" ? baseHref : `${baseHref}?tab=${key}`,
    active: tab === key,
  }));

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
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLE[detail.tenant.status]}`}
          >
            {statusLabel(tAll, detail.tenant.status)}
          </span>
          <Link
            href={`/${locale}/super-admin/subscribers/${slug}`}
            prefetch={false}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
          >
            {t("editSubscriber")}
          </Link>
          {activeGrant ? (
            <div className="flex items-center gap-2">
              <Link
                href={`/${locale}/${slug}`}
                prefetch={false}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                {t("continue")}
              </Link>
              <form action={endImpersonationAction}>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="slug" value={slug} />
                <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
                  {t("endAccess")}
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
                {t("enter")}
              </button>
            </form>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} />

      {tab === "overview" && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiTile icon="orders" accent="emerald" label={t("orders")} value={String(detail.ordersCount)} trend={null} href={`${baseHref}?tab=orders`} />
            <KpiTile
              icon="conversations"
              accent="blue"
              label={t("conversations")}
              value={String(detail.conversationsCount)}
              trend={null}
          href={`${baseHref}?tab=agent`}
        />
            <KpiTile
              icon="agent"
              accent="emerald"
              label={t("agent")}
              value={detail.agent.active ? t("active") : t("inactive")}
              trend={null}
          href={`${baseHref}?tab=agent`}
        />
            <KpiTile
              icon="billing"
              accent="orange"
              label={t("totalPaid")}
              value={money(detail.paymentSummary.totalPaidMinor, detail.paymentSummary.currency)}
              trend={null}
          href={`${baseHref}?tab=billing`}
        />
          </div>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("profile")}</h2>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <dt className="text-slate-500">{t("owner")}</dt>
              <dd className="text-slate-900">
                {detail.owner ? `${detail.owner.name}${detail.owner.email ? ` (${detail.owner.email})` : ""}` : "—"}
              </dd>
              <dt className="text-slate-500">{t("contact")}</dt>
              <dd className="text-slate-900">{detail.tenant.contactEmail ?? detail.tenant.contactPhone ?? "—"}</dd>
              <dt className="text-slate-500">{t("website")}</dt>
              <dd className="text-slate-900">{detail.tenant.websiteUrl ?? "—"}</dd>
              <dt className="text-slate-500">{t("city")}</dt>
              <dd className="text-slate-900">{detail.tenant.city ?? "—"}</dd>
              <dt className="text-slate-500">{t("timezone")}</dt>
              <dd className="text-slate-900">{detail.tenant.timezone}</dd>
              <dt className="text-slate-500">{t("currency")}</dt>
              <dd className="text-slate-900">{detail.tenant.currency}</dd>
              <dt className="text-slate-500">{t("deployment")}</dt>
              <dd className="text-slate-900">{t.has(`mode.${detail.tenant.deploymentMode}`) ? t(`mode.${detail.tenant.deploymentMode}`) : detail.tenant.deploymentMode}</dd>
              <dt className="text-slate-500">{t("created")}</dt>
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
              label={t("sources")}
              value={String(detail.brain.sourceCount)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="billing"
              accent="orange"
              label={t("pending")}
              value={String(detail.brain.pendingReview)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="orders"
              accent="blue"
              label={t("approved")}
              value={String(detail.brain.approvedEntries)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
            <KpiTile
              icon="alert"
              accent="purple"
              label={t("conflicts")}
              value={String(detail.brain.openConflicts)}
              trend={null}
          href={`${baseHref}?tab=brain`}
        />
          </div>
          {detail.brain.sourceCount === 0 && detail.brain.approvedEntries === 0 && (
            <EmptyState
              title={t("noBrain")}
              description={t("noBrainDescription")}
            />
          )}
        </div>
      )}

      {tab === "agent" && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <KpiTile
            icon="agent"
            accent="emerald"
            label={t("status")}
            value={detail.agent.active ? t("active") : t("inactive")}
            trend={null}
          href={`/${locale}/super-admin/subscribers/${slug}`}
        />
          <KpiTile
            icon="conversations"
            accent="blue"
            label={t("interactions")}
            value={String(detail.agent.interactions30d)}
            trend={null}
          href={`${baseHref}?tab=agent`}
        />
          <KpiTile
            icon="analytics"
            accent="purple"
            label={t("withoutAi")}
            value={`${detail.agent.deterministicPct}%`}
            trend={null}
          href={`${baseHref}?tab=agent`}
        />
          <KpiTile
            icon="billing"
            accent="orange"
            label={t("aiCost30")}
            value={`$${detail.agent.costUsd30d.toFixed(4)}`}
            trend={null}
          href={`${baseHref}?tab=usage`}
        />
        </div>
      )}

      {tab === "agent" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">{t("costGuard")}</h2>
          <p className="mb-3 text-xs text-slate-500">
            {detail.costGuard.budgetUsd !== null
              ? `${t("spentOf", { spent: detail.costGuard.spentUsd.toFixed(2), budget: detail.costGuard.budgetUsd.toFixed(2) })}${
                  detail.costGuard.exceeded ? t("reached") : "."
                }`
              : t("spentNoBudget", { spent: detail.costGuard.spentUsd.toFixed(2) })}
          </p>
          <form action={setTenantAiBudgetAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={detail.tenant.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <label className="flex flex-col gap-1 text-sm">
              {t("overrideBudget")}
              <input
                name="budgetUsd"
                type="number"
                step="0.01"
                min="0"
                placeholder={t("usePlatform")}
                defaultValue={detail.costGuard.tenantOverrideUsd ?? undefined}
                className="w-40 rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              {t("save")}
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
              title={t("noSubscription")}
              description={t("usageNoSub")}
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
                    <th className="py-2 text-start font-medium">{t("customer")}</th>
                    <th className="py-2 text-start font-medium">{t("total")}</th>
                    <th className="py-2 text-start font-medium">{t("status")}</th>
                    <th className="py-2 text-start font-medium">{t("date")}</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recentOrders.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-medium text-slate-900">#{o.orderNumber}</td>
                      <td className="py-2 text-slate-600">{o.customerName ?? "—"}</td>
                      <td className="py-2 text-slate-600">{money(o.totalMinor)}</td>
                      <td className="py-2 text-slate-600">{statusLabel(tAll, o.status)}</td>
                      <td className="py-2 text-slate-500">{new Date(o.createdAt).toLocaleDateString(locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title={t("noOrders")} description={t("noOrdersDescription")} />
          )}
        </section>
      )}

      {tab === "billing" && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          {detail.subscription ? (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-slate-500">{t("plan")}</dt>
              <dd className="text-slate-900">{detail.subscription.planLabel}</dd>
              <dt className="text-slate-500">{t("status")}</dt>
              <dd className="text-slate-900">{statusLabel(tAll, detail.subscription.status)}</dd>
              {detail.subscription.trialEndsAt && (
                <>
                  <dt className="text-slate-500">{t("trialEnds")}</dt>
                  <dd className="text-slate-900">
                    {new Date(detail.subscription.trialEndsAt).toLocaleDateString(locale)}
                  </dd>
                </>
              )}
              {detail.subscription.currentPeriodEnd && (
                <>
                  <dt className="text-slate-500">{t("renews")}</dt>
                  <dd className="text-slate-900">
                    {new Date(detail.subscription.currentPeriodEnd).toLocaleDateString(locale)}
                  </dd>
                </>
              )}
              <dt className="text-slate-500">{t("totalPaid")}</dt>
              <dd className="text-slate-900">
                {money(detail.paymentSummary.totalPaidMinor, detail.paymentSummary.currency)}
              </dd>
            </dl>
          ) : (
            <EmptyState title={t("noSubscription")} description={t("noPlanDescription")} />
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
                    <span className="font-medium text-slate-900">{auditActionLabel(tAll, event.action)}</span>
                    {event.actorName && <span className="text-slate-500">{tAll("common.byActor", { name: event.actorName })}</span>}
                  </p>
                  <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString(locale)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("noActivity")} description={t("noActivityDescription")} />
          )}
        </section>
      )}
    </div>
  );
}

const usd = (v: number | null, digits = 2) => (v === null ? "—" : `$${v.toFixed(digits)}`);

/** Super Admin only: this period's conversation and AI-cost usage, plan defaults vs overrides. */
function UsageLimitsSection({ usage, locale, slug }: { usage: SubscriberUsageRow; locale: string; slug: string }) {
  const t = useTranslations("platform.business360");
  const tAll = useTranslations();
  const date = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : "—";
  const aiRemaining = usage.aiCostLimit !== null ? Math.max(0, usage.aiCostLimit - usage.aiCostUsed) : null;
  const convRemaining =
    usage.conversationLimit !== null ? Math.max(0, usage.conversationLimit - usage.conversationsUsed) : null;
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">{t("u.title")}</h2>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${USAGE_STATE_STYLE[usage.usageState]}`}>
          {tAll.has(`platform.usageState.${usage.usageState}`) ? tAll(`platform.usageState.${usage.usageState}`) : usage.usageState.replace(/_/g, " ")}
        </span>
      </div>
      {usage.isTrial ? (
        <p className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">
          {t("u.trial", {
            date: date(usage.periodEnd),
            limit: usage.conversationLimit?.toLocaleString(locale) ?? "∞",
            allowance: usd(usage.aiCostLimit),
            ended: usage.trialEnded ? t("u.ended", { reason: usage.trialEndReason?.replace(/_/g, " ") ?? "" }) : "",
          })}
        </p>
      ) : (
        !usage.isPaid && (
          <p className="rounded-md bg-blue-50 p-3 text-xs text-blue-800">
            {t("u.notPaid", { status: statusLabel(tAll, usage.status) })}
          </p>
        )
      )}

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <dt className="text-slate-500">{t("u.plan")}</dt>
        <dd className="text-slate-900">{tAll.has(`common.plan.${usage.planKey}`) ? tAll(`common.plan.${usage.planKey}`) : usage.planKey}</dd>
        <dt className="text-slate-500">{usage.isTrial ? t("u.trialPeriod") : t("u.billingPeriod")}</dt>
        <dd className="text-slate-900">
          {date(usage.periodStart)} → {date(usage.periodEnd)}
          {!usage.isTrial && t("u.resets", { date: date(usage.periodEnd) })}
        </dd>
        <dt className="text-slate-500">{t("u.conversations")}</dt>
        <dd className="text-slate-900">
          {usage.conversationsUsed.toLocaleString(locale)} /{" "}
          {usage.conversationLimit?.toLocaleString(locale) ?? t("u.noLimit")}
          {usage.conversationPercent !== null && ` (${usage.conversationPercent}%)`}
          {convRemaining !== null && t("u.remaining", { n: convRemaining.toLocaleString(locale) })}
        </dd>
        {usage.graceUntil && (
          <>
            <dt className="text-slate-500">{t("u.graceUntil")}</dt>
            <dd className="text-slate-900">{new Date(usage.graceUntil).toLocaleString(locale)}</dd>
          </>
        )}
        <dt className="text-slate-500">{usage.isTrial ? t("u.aiTrial") : t("u.aiCap")}</dt>
        <dd className="text-slate-900">
          {usd(usage.aiCostUsed, 4)} / {usd(usage.aiCostLimit)}
          {usage.aiCostPercent !== null && ` (${usage.aiCostPercent}%)`}
          {aiRemaining !== null && t("u.remaining", { n: usd(aiRemaining, 4) })}
          {usage.aiCostReserved > 0 && t("u.inFlight", { n: usd(usage.aiCostReserved, 4) })}
        </dd>
        <dt className="text-slate-500">{t("u.agentAll")}</dt>
        <dd className="text-slate-900">
          {t("u.responses", { cost: usd(usage.agentAiCost, 4), n: usage.agentAiResponses.toLocaleString(locale) })}
        </dd>
        <dt className="text-slate-500">{t("u.voice")}</dt>
        <dd className="text-slate-900">
          {t("u.voiceValue", { cost: usd(usage.agentVoiceCost, 4), clips: usage.agentVoiceClips.toLocaleString(locale), chars: usage.agentVoiceCharacters.toLocaleString(locale) })}
        </dd>
        <dt className="text-slate-500">{t("u.brain")}</dt>
        <dd className="text-slate-900">
          {t("u.brainValue", { period: usd(usage.brainAiCost, 4), total: usd(usage.brainAiCostTotal, 4) })}
        </dd>
      </dl>

      <div className="border-t border-slate-100 pt-4">
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">{t("u.limits")}</p>
        <p className="mb-3 text-xs text-slate-500">
          {t("u.limitsNote", {
            defConv: usage.conversationLimitDefault?.toLocaleString(locale) ?? t("u.noLimit"),
            defAi: usd(usage.aiCostLimitDefault),
            conv: usage.conversationLimit?.toLocaleString(locale) ?? t("u.noLimit"),
            ai: usd(usage.aiCostLimit),
          })}
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
