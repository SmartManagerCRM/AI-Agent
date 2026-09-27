import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { AgentTestPanel } from "@/components/agent/agent-test-panel";
import { platformOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env";
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

  const env = serverEnv();
  const agentOrigin = platformOrigin(env.AGENT_SUBDOMAIN, {
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
  });
  const agentUrl = `${agentOrigin}/${tenant.slug}`;
  const embedSnippet = `<script src="${agentOrigin}/api/widget/embed?tenant=${tenant.slug}" async></script>`;

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Agent</h1>

      <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
        <h2 className="text-sm font-semibold text-neutral-700">Where is your Agent reachable?</h2>
        <form action={setDeploymentModeAction} className="flex items-center gap-2">
          <input type="hidden" name="tenantId" value={tenant.id} />
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="slug" value={slug} />
          <select name="deploymentMode" defaultValue={tenant.deployment_mode} className="rounded-md border border-neutral-300 px-3 py-2 text-sm">
            {DEPLOYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {DEPLOYMENT_MODE_LABELS[mode]}
              </option>
            ))}
          </select>
          <button type="submit" className="rounded-md bg-neutral-900 px-3 py-2 text-xs font-medium text-white">
            Save
          </button>
        </form>
      </section>

      {(tenant.deployment_mode === "external_agent" || tenant.deployment_mode === "both") && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold text-neutral-700">Your public Agent link</h2>
          <p className="text-xs text-neutral-500">
            No website needed — share this anywhere: Instagram bio, WhatsApp, a QR code, receipts.
          </p>
          <a href={agentUrl} className="break-all text-sm text-blue-700 underline">
            {agentUrl}
          </a>
        </section>
      )}

      {(tenant.deployment_mode === "website_widget" || tenant.deployment_mode === "both") && (
        <section className="flex flex-col gap-2 rounded-md border border-neutral-200 p-4">
          <h2 className="text-sm font-semibold text-neutral-700">Add to your website</h2>
          <p className="text-xs text-neutral-500">Paste this once, right before the closing {"</body>"} tag of your site.</p>
          <pre className="overflow-x-auto rounded-md bg-neutral-900 p-3 text-xs text-neutral-100">{embedSnippet}</pre>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Settings</h2>
        <AgentSettingsForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          current={settings?.agent ?? { active: false, assistant_name: null, greeting: null, tone: "friendly" }}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Try it (last 30 days)</h2>
        <div className="flex flex-wrap gap-6 text-sm">
          <Stat label="Interactions" value={String(summary?.total_interactions ?? 0)} />
          <Stat label="Handled without AI" value={`${summary?.deterministic_pct ?? 0}%`} />
          <Stat label="AI cost" value={`$${Number(summary?.total_cost_usd ?? 0).toFixed(4)}`} />
        </div>
        <AgentTestPanel tenantId={tenant.id} currency={tenant.currency} slug={slug} locale={locale} />
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}
