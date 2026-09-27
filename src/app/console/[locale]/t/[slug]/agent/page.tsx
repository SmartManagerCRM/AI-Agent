import { AgentSettingsForm } from "@/components/agent/agent-settings-form";
import { AgentTestPanel } from "@/components/agent/agent-test-panel";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function AgentPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: settings }, { data: stats }] = await Promise.all([
    supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.rpc("agent_interaction_stats", { p_tenant_id: tenant.id }),
  ]);
  const summary = stats?.[0];

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Agent</h1>

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
