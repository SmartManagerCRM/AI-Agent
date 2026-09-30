import QRCode from "qrcode";

import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { AgentTestPanel } from "@/components/agent/agent-test-panel";
import { Button } from "@/components/console/button";
import { CopyButton } from "@/components/console/copy-button";
import { KpiTile } from "@/components/console/kpi-tile";
import { publicAgentUrls } from "@/server/agent-public/urls";
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

  const [{ data: settings }, { data: stats }] = await Promise.all([
    supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.rpc("agent_interaction_stats", { p_tenant_id: tenant.id }),
  ]);
  const summary = stats?.[0];
  const agentSettings = settings?.agent ?? { active: false, assistant_name: null, greeting: null, tone: "friendly" };

  // Canonical public Agent URL (path-based on the platform host unless a verified AGENT_URL is configured).
  const agentUrls = publicAgentUrls();
  const agentUrl = agentUrls.agent(tenant.slug);
  const embedSnippet = `<script src="${agentUrls.embedScript(tenant.slug)}" async></script>`;
  // Generated locally (same `qrcode` package as table QR codes) — encodes exactly the canonical URL.
  const qrDataUrl = await QRCode.toDataURL(agentUrl, { width: 480, margin: 1 });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Agent</h1>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            agentSettings.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${agentSettings.active ? "bg-emerald-500" : "bg-slate-400"}`} />
          {agentSettings.active ? "Active" : "Inactive"}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile icon="conversations" accent="emerald" label="Interactions (30d)" value={String(summary?.total_interactions ?? 0)} trend={null} />
        <KpiTile icon="analytics" accent="blue" label="Handled without AI" value={`${summary?.deterministic_pct ?? 0}%`} trend={null} />
        <KpiTile icon="billing" accent="purple" label="AI cost (30d)" value={`$${Number(summary?.total_cost_usd ?? 0).toFixed(4)}`} trend={null} />
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

      {(tenant.deployment_mode === "external_agent" || tenant.deployment_mode === "both") && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">Your public Agent link</h2>
          <p className="mt-1 text-xs text-slate-500">No website needed — share this anywhere: Instagram bio, WhatsApp, a QR code, receipts.</p>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated locally by the `qrcode` package, not a project asset */}
            <img src={qrDataUrl} alt="QR code linking to your Agent" width={112} height={112} className="rounded-lg border border-slate-200" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800">{agentUrl}</p>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={agentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  Open Agent
                </a>
                <CopyButton value={agentUrl} label="Copy URL" />
                <a
                  href={qrDataUrl}
                  download={`${tenant.slug}-agent-qr.png`}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Download QR code
                </a>
              </div>
            </div>
          </div>
        </section>
      )}

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
