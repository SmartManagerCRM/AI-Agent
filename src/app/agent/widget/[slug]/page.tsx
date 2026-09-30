import { notFound } from "next/navigation";

import { AgentExperience } from "@/components/agent-public/agent-experience";
import { AgentI18nProvider } from "@/components/agent-public/agent-i18n";
import { AgentInactive } from "@/components/agent-public/agent-inactive";
import { AgentUnavailable } from "@/components/agent-public/agent-unavailable";
import { loadAgentExperience } from "@/server/agent-public/experience";
import { resolveWidgetAgent } from "@/server/agent-public/tenant";

export const dynamic = "force-dynamic";

/**
 * The embeddable widget (spec §45, Phase 10) — reachable at
 * `agent.<root>/widget/<slug>`, meant to be loaded inside the small
 * floating iframe the embed snippet
 * (`src/app/api/widget/embed/route.ts`) injects into a tenant's own
 * website, not visited directly. Same data (`loadAgentExperience`) and the
 * same `AgentExperience` as the standalone External Agent page
 * (`src/app/agent/[slug]/page.tsx`) — only `resolveWidgetTenant` (checks
 * `deployment_mode` for `website_widget`/`both` instead of
 * `external_agent`/`both`) and the `website_widget` surface threaded into
 * every action differ; the iframe's narrow viewport gets the mobile
 * layout. `src/proxy.ts` carries this one route's own, deliberately
 * permissive `frame-ancestors *` — every other route stays
 * `frame-ancestors 'none'`.
 */
export default async function WidgetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const resolution = await resolveWidgetAgent(slug);
  if (resolution.state === "not_found") notFound();
  if (resolution.state !== "live") {
    return <AgentUnavailable reason={resolution.state} businessName={resolution.businessName} defaultLanguage={resolution.defaultLanguage} />;
  }
  const { tenant } = resolution;

  const data = await loadAgentExperience(tenant, { surface: "website_widget" });
  if (!data.active) return <AgentInactive locale={data.locale} businessName={data.businessName} text={data.inactiveText} />;

  return (
    <AgentI18nProvider locale={data.locale} messages={data.messages.agent}>
      <AgentExperience {...data.props} />
    </AgentI18nProvider>
  );
}
