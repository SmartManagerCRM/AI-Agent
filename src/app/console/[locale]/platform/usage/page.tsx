import Link from "next/link";

import { KpiTile } from "@/components/console/kpi-tile";
import { UsageSettingsForm } from "@/components/platform/usage-limits-forms";
import { loadPlatformUsage, loadUsageSettings } from "@/server/platform/usage";
import { loadVoiceAccount } from "@/server/platform/voice-account";
import { summarizePlatformUsage, USAGE_STATE_STYLE, type SubscriberUsageRow } from "@/server/platform/usage-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { displayMoney } from "@/server/platform/display-currency";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { RichMsg } from "@/components/i18n/msg";
import { statusLabel } from "@/lib/i18n-labels";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/**
 * Super Admin: subscription usage and AI cost across all subscribers, each
 * in its own current billing period. AI dollar figures exist only here and
 * on the business page's Usage Limits tab — never in the subscriber console.
 */
/** The count boxes' filters — the same predicates their counts use (`summarizePlatformUsage`). */
const FILTERS: Record<string, { match: (r: SubscriberUsageRow) => boolean }> = {
  near_conversation_limit: { match: (r) => r.isPaid && r.usageState === "CONVERSATION_WARNING" },
  near_ai_cost_cap: { match: (r) => r.isPaid && r.aiState === "warning" },
  grace: { match: (r) => r.isPaid && r.conversationState === "grace" },
  conversation_limited: { match: (r) => r.isPaid && r.conversationState === "blocked" },
  ai_cost_limited: { match: (r) => r.isPaid && r.aiState === "blocked" },
  both_limits: { match: (r) => r.isPaid && r.usageState === "BOTH_LIMITS_REACHED" },
  trials_ended: {
    match: (r) => r.isTrial && (r.trialEndReason === "conversation_limit" || r.trialEndReason === "ai_cost_limit"),
  },
};

export default async function PlatformUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { locale } = await params;
  const { filter: filterParam } = await searchParams;
  const filter = filterParam && FILTERS[filterParam] ? filterParam : null;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.usagePage");
  const tAll = await getTranslations();
  const [rows, settings, voiceAccount, { usd }] = await Promise.all([
    loadPlatformUsage(supabase),
    loadUsageSettings(supabase),
    loadVoiceAccount(),
    displayMoney(supabase, locale),
  ]);
  const summary = summarizePlatformUsage(rows);
  const base = `/${locale}/super-admin/usage`;
  const sorted = [...(filter ? rows.filter(FILTERS[filter].match) : rows)].sort(
    (a, b) =>
      Math.max(b.conversationPercent ?? 0, b.aiCostPercent ?? 0) -
        Math.max(a.conversationPercent ?? 0, a.aiCostPercent ?? 0) || b.agentAiCost - a.agentAiCost,
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <KpiTile
          icon="billing"
          accent="orange"
          label={t("kpi.agentCost")}
          value={usd(summary.totalAgentAiCost, 4)}
          trend={null}
          href={`/${locale}/super-admin/usage#subscribers`}
        />
        <KpiTile
          icon="branches"
          accent="purple"
          label={t("kpi.brainCost")}
          value={usd(summary.totalBrainAiCost, 4)}
          trend={null}
          href={`/${locale}/super-admin/business-brain`}
        />
        <KpiTile
          icon="agent"
          accent="emerald"
          label={
            voiceAccount.free
              ? t("kpi.voiceFree", { clips: summary.totalVoiceClips.toLocaleString(locale), cost: usd(summary.totalVoiceCost, 4) })
              : t("kpi.voicePaid", { clips: summary.totalVoiceClips.toLocaleString(locale) })
          }
          value={voiceAccount.exhausted ? t("usedUp") : voiceAccount.free ? t("free") : usd(summary.totalVoiceCost, 4)}
          trend={null}
          href={`/${locale}/super-admin/usage#by-plan`}
        />
        <KpiTile
          icon="conversations"
          accent="blue"
          label={t("kpi.perConversation")}
          value={usd(summary.avgCostPerConversation, 5)}
          trend={null}
          href={`/${locale}/super-admin/usage#by-plan`}
        />
        <KpiTile
          icon="sparkle"
          accent="teal"
          label={t("kpi.perResponse")}
          value={usd(summary.avgCostPerAiResponse, 5)}
          trend={null}
          href={`/${locale}/super-admin/ai-agents`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
        {(
          [
            ["near_conversation_limit", summary.approachingConversationLimit],
            ["near_ai_cost_cap", summary.approachingAiCostLimit],
            ["grace", summary.inGracePeriod],
            ["conversation_limited", summary.conversationLimited],
            ["ai_cost_limited", summary.aiCostLimited],
            ["both_limits", summary.bothLimited],
            ["trials_ended", summary.trialsEndedByLimit],
          ] as const
        ).map(([key, value]) => (
          <Link
            key={key}
            href={`${base}?filter=${key}#subscribers`}
            prefetch={false}
            className={`rounded-xl border bg-white p-3 transition hover:border-emerald-300 hover:shadow-sm ${filter === key ? "border-emerald-400" : "border-slate-200"}`}
          >
            <p className="text-xs text-slate-500">{t(`filter.${key}`)}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
          </Link>
        ))}
      </div>

      <section id="by-plan" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("byPlan")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                <th className="py-2 text-start font-medium">{t("col.subscribers")}</th>
                <th className="py-2 text-start font-medium">{t("col.conversations")}</th>
                <th className="py-2 text-start font-medium">{t("col.agentCost")}</th>
                <th className="py-2 text-start font-medium">{t("col.voiceCost")}</th>
                <th className="py-2 text-start font-medium">{t("col.avgConv")}</th>
                <th className="py-2 text-start font-medium">{t("col.avgAi")}</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPlan.map((p) => (
                <tr key={p.planKey} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium text-slate-900">{tAll.has(`common.plan.${p.planKey}`) ? tAll(`common.plan.${p.planKey}`) : p.planKey}</td>
                  <td className="py-2 text-slate-600">
                    {p.subscribers} ({p.paidSubscribers})
                  </td>
                  <td className="py-2 text-slate-600">{p.conversations.toLocaleString(locale)}</td>
                  <td className="py-2 text-slate-600">{usd(p.agentAiCost, 4)}</td>
                  <td className="py-2 text-slate-600">{usd(p.agentVoiceCost, 4)}</td>
                  <td className="py-2 text-slate-600">{pct(p.avgConversationUtilization)}</td>
                  <td className="py-2 text-slate-600">{pct(p.avgAiCostUtilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="subscribers" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">
            {t("subscribers")}{filter ? ` — ${t(`filter.${filter}`)}` : ""}
          </h2>
          {filter && (
            <Link href={`${base}#subscribers`} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
              {t("showAll")}
            </Link>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">{t("col.business")}</th>
                <th className="py-2 text-start font-medium">{t("col.plan")}</th>
                <th className="py-2 text-start font-medium">{t("col.period")}</th>
                <th className="py-2 text-start font-medium">{t("col.conversations")}</th>
                <th className="py-2 text-start font-medium">{t("col.aiCap")}</th>
                <th className="py-2 text-start font-medium">{t("col.brain")}</th>
                <th className="py-2 text-start font-medium">{t("col.state")}</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.tenantId} className="border-b border-slate-100 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/${locale}/super-admin/businesses/${r.slug}?tab=usage`}
                      prefetch={false}
                      className="font-medium text-emerald-700 hover:underline"
                    >
                      {r.businessName}
                    </Link>
                  </td>
                  <td className="py-2 text-slate-600">
                    {tAll.has(`common.plan.${r.planKey}`) ? tAll(`common.plan.${r.planKey}`) : r.planKey}{" "}
                    <span className="text-xs text-slate-400">({statusLabel(tAll, r.status)})</span>
                  </td>
                  <td className="whitespace-nowrap py-2 text-xs text-slate-500">
                    {r.periodStart ? new Date(r.periodStart).toLocaleDateString(locale) : "—"} –{" "}
                    {r.periodEnd ? new Date(r.periodEnd).toLocaleDateString(locale) : "—"}
                  </td>
                  <td className="py-2 text-slate-600">
                    {r.conversationsUsed.toLocaleString(locale)} / {r.conversationLimit?.toLocaleString(locale) ?? "∞"}{" "}
                    <span className="text-xs text-slate-400">{pct(r.conversationPercent)}</span>
                  </td>
                  <td className="py-2 text-slate-600">
                    {usd(r.isPaid || r.isTrial ? r.aiCostUsed : r.agentAiCost, 4)} / {usd(r.aiCostLimit)}{" "}
                    <span className="text-xs text-slate-400">
                      {r.isPaid || r.isTrial ? pct(r.aiCostPercent) : t("notCapped")}
                    </span>
                  </td>
                  <td className="py-2 text-slate-600">{usd(r.brainAiCost, 4)}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${USAGE_STATE_STYLE[r.usageState]}`}>
                      {tAll.has(`platform.usageState.${r.usageState}`) ? tAll(`platform.usageState.${r.usageState}`) : r.usageState.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    {filter ? t("noMatch") : t("none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">{t("thresholds")}</h2>
        <p className="mb-3 text-xs text-slate-500">
          <RichMsg
            id="platform.usagePage.thresholdsNote"
            values={{
              link: (c) => (
                <Link href={`/${locale}/super-admin/plans`} prefetch={false} className="text-emerald-700 hover:underline">
                  {c}
                </Link>
              ),
            }}
          />
        </p>
        <UsageSettingsForm
          locale={locale}
          conversationWarningPercents={settings.conversationWarningPercents}
          aiCostWarningPercent={settings.aiCostWarningPercent}
          trialConversationLimit={settings.trialConversationLimit}
          trialAiCostLimitUsd={settings.trialAiCostLimitUsd}
        />
      </section>
    </div>
  );
}
