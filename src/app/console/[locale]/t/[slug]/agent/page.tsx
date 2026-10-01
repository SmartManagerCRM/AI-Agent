import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { AgentTestPanel } from "@/components/agent/agent-test-panel";
import { GoLivePanel, LiveBadge } from "@/components/agent/go-live-panel";
import { Button } from "@/components/console/button";
import { CopyButton } from "@/components/console/copy-button";
import { KpiTile } from "@/components/console/kpi-tile";
import { loadGoLive } from "@/server/agent-public/go-live";
import { publicAgentUrls } from "@/server/agent-public/urls";
import { loadSubscriberUsage } from "@/server/billing/usage-summary";
import { setDeploymentModeAction } from "@/server/business/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const DEPLOYMENT_MODES = ["external_agent", "website_widget", "both"] as const;
const DEPLOYMENT_MODE_LABELS: Record<(typeof DEPLOYMENT_MODES)[number], string> = {
  external_agent: "Standalone link only",
  website_widget: "Website widget only",
  both: "Both",
};

export default async function AgentPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: settings }, { data: stats }, goLive, usage] = await Promise.all([
    supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.rpc("agent_interaction_stats", { p_tenant_id: tenant.id }),
    loadGoLive(supabase, tenant, locale),
    loadSubscriberUsage(supabase, tenant.id),
  ]);
  const summary = stats?.[0];
  const agentSettings = settings?.agent ?? { active: false, assistant_name: null, greeting: null, tone: "friendly" };

  const embedSnippet = `<script src="${publicAgentUrls().embedScript(tenant.slug)}" async></script>`;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Agent</h1>
        <LiveBadge status={goLive.status} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile
          icon="conversations"
          accent="emerald"
          label="Interactions (30d)"
          value={String(summary?.total_interactions ?? 0)}
          trend={null}
          href={`/${locale}/${slug}/conversations`}
        />
        <KpiTile
          icon="analytics"
          accent="blue"
          label="Handled without AI"
          value={`${summary?.deterministic_pct ?? 0}%`}
          trend={null}
          href={`/${locale}/${slug}/analytics`}
        />
        <KpiTile
          icon="customers"
          accent="purple"
          label={usage?.isTrial ? "Customer conversations (trial)" : "Customer conversations (this period)"}
          value={
            usage
              ? usage.conversationLimit !== null
                ? `${usage.conversationsUsed.toLocaleString(locale)} / ${usage.conversationLimit.toLocaleString(locale)}`
                : usage.conversationsUsed.toLocaleString(locale)
              : "—"
          }
          trend={null}
          href={`/${locale}/${slug}/billing`}
        />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold text-slate-900">Where is your Agent reachable?</h2>
        <form action={setDeploymentModeAction} className="flex items-center gap-2">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <select
            name="deploymentMode"
            defaultValue={tenant.deployment_mode}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            {DEPLOYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {DEPLOYMENT_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <Button type="submit" className="text-xs">
            Save
          </Button>
        </form>
      </section>

      {/* Go live review before publishing; the public link, QR code and pause control once live. */}
      <GoLivePanel state={goLive} slug={slug} locale={locale} />

      {(tenant.deployment_mode === "website_widget" || tenant.deployment_mode === "both") && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Add to your website</h2>
          <p className="mt-1 text-xs text-slate-500">Paste this once, right before the closing {"</body>"} tag of your site.</p>
          <div className="mt-3 flex items-start gap-2">
            <pre className="flex-1 overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{embedSnippet}</pre>
            <CopyButton value={embedSnippet} />
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">AI behavior</h2>
        <AgentSettingsForm tenantId={tenant.id} slug={slug} locale={locale} current={agentSettings} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Try it</h2>
        <AgentTestPanel tenantId={tenant.id} currency={tenant.currency} slug={slug} locale={locale} />
      </section>
    </div>
  );
}
