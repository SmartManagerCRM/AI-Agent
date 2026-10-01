import Link from "next/link";

import { KpiTile } from "@/components/console/kpi-tile";
import { UsageSettingsForm } from "@/components/platform/usage-limits-forms";
import { loadPlatformUsage, loadUsageSettings } from "@/server/platform/usage";
import { summarizePlatformUsage, USAGE_STATE_STYLE } from "@/server/platform/usage-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const usd = (v: number | null, digits = 2) => (v === null ? "—" : `$${v.toFixed(digits)}`);
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);

/**
 * Super Admin: subscription usage and AI cost across all subscribers, each
 * in its own current billing period. AI dollar figures exist only here and
 * on the business page's Usage Limits tab — never in the subscriber console.
 */
export default async function PlatformUsagePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const [rows, settings] = await Promise.all([loadPlatformUsage(supabase), loadUsageSettings(supabase)]);
  const summary = summarizePlatformUsage(rows);
  const sorted = [...rows].sort(
    (a, b) =>
      Math.max(b.conversationPercent ?? 0, b.aiCostPercent ?? 0) -
        Math.max(a.conversationPercent ?? 0, a.aiCostPercent ?? 0) || b.agentAiCost - a.agentAiCost,
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Usage &amp; AI Cost</h1>
        <p className="mt-1 text-sm text-slate-500">
          Each subscriber&apos;s current billing period. Agent AI cost excludes Business Brain analysis, which is shown
          separately.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="billing"
          accent="orange"
          label="Agent AI cost (current periods)"
          value={usd(summary.totalAgentAiCost, 4)}
          trend={null}
        />
        <KpiTile
          icon="branches"
          accent="purple"
          label="Business Brain AI cost"
          value={usd(summary.totalBrainAiCost, 4)}
          trend={null}
        />
        <KpiTile
          icon="conversations"
          accent="blue"
          label="Avg AI cost / conversation"
          value={usd(summary.avgCostPerConversation, 5)}
          trend={null}
        />
        <KpiTile
          icon="sparkle"
          accent="teal"
          label="Avg AI cost / AI response"
          value={usd(summary.avgCostPerAiResponse, 5)}
          trend={null}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {[
          ["Near conversation limit", summary.approachingConversationLimit],
          ["Near AI cost cap", summary.approachingAiCostLimit],
          ["In grace period", summary.inGracePeriod],
          ["Conversation-limited", summary.conversationLimited],
          ["AI-cost-limited", summary.aiCostLimited],
          ["Both limits reached", summary.bothLimited],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">By plan</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">Plan</th>
                <th className="py-2 text-start font-medium">Subscribers (paid)</th>
                <th className="py-2 text-start font-medium">Conversations</th>
                <th className="py-2 text-start font-medium">Agent AI cost</th>
                <th className="py-2 text-start font-medium">Avg conversation use</th>
                <th className="py-2 text-start font-medium">Avg AI cap use</th>
              </tr>
            </thead>
            <tbody>
              {summary.byPlan.map((p) => (
                <tr key={p.planKey} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 font-medium capitalize text-slate-900">{p.planKey}</td>
                  <td className="py-2 text-slate-600">
                    {p.subscribers} ({p.paidSubscribers})
                  </td>
                  <td className="py-2 text-slate-600">{p.conversations.toLocaleString(locale)}</td>
                  <td className="py-2 text-slate-600">{usd(p.agentAiCost, 4)}</td>
                  <td className="py-2 text-slate-600">{pct(p.avgConversationUtilization)}</td>
                  <td className="py-2 text-slate-600">{pct(p.avgAiCostUtilization)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscribers</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">Business</th>
                <th className="py-2 text-start font-medium">Plan</th>
                <th className="py-2 text-start font-medium">Period</th>
                <th className="py-2 text-start font-medium">Conversations</th>
                <th className="py-2 text-start font-medium">AI cost / cap</th>
                <th className="py-2 text-start font-medium">Brain AI</th>
                <th className="py-2 text-start font-medium">State</th>
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
                  <td className="py-2 capitalize text-slate-600">
                    {r.planKey} <span className="text-xs text-slate-400">({r.status})</span>
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
                    {usd(r.isPaid ? r.aiCostUsed : r.agentAiCost, 4)} / {usd(r.aiCostLimit)}{" "}
                    <span className="text-xs text-slate-400">{r.isPaid ? pct(r.aiCostPercent) : "not capped"}</span>
                  </td>
                  <td className="py-2 text-slate-600">{usd(r.brainAiCost, 4)}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${USAGE_STATE_STYLE[r.usageState]}`}>
                      {r.usageState.replace(/_/g, " ")}
                    </span>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-slate-400">
                    No subscriptions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-1 text-sm font-semibold text-slate-900">Warning thresholds</h2>
        <p className="mb-3 text-xs text-slate-500">
          Subscribers see conversation warnings at these levels (plus 100%). The AI cost warning is visible to Super
          Admin only. Plan limits are edited on{" "}
          <Link href={`/${locale}/super-admin/plans`} prefetch={false} className="text-emerald-700 hover:underline">
            Subscriptions &amp; Plans
          </Link>
          .
        </p>
        <UsageSettingsForm
          locale={locale}
          conversationWarningPercents={settings.conversationWarningPercents}
          aiCostWarningPercent={settings.aiCostWarningPercent}
        />
      </section>
    </div>
  );
}
