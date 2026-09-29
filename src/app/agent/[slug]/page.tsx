import { notFound } from "next/navigation";

import { AgentExperience } from "@/components/agent-public/agent-experience";
import { AgentI18nProvider } from "@/components/agent-public/agent-i18n";
import { AgentInactive } from "@/components/agent-public/agent-inactive";
import { loadAgentExperience } from "@/server/agent-public/experience";
import { resolvePublicTenant } from "@/server/agent-public/tenant";

export const dynamic = "force-dynamic";

/**
 * The standalone External Agent (addendum §14–§18, and the Customer Agent
 * Master Prompt §3-§5): a complete branded customer experience reachable
 * with **no website required** — `agent.<root>/<slug>`. Business identity,
 * products and the conversation all read the same Business Brain /
 * catalog the console manages; there is no separate "external agent" copy
 * of any of it (addendum §20).
 *
 * On open, everything is plain server-rendered data
 * (`loadAgentExperience`) — no AI call, no `runAgentGateway` invocation,
 * not even a cart row until the customer actually adds something.
 * Category navigation, browsing, price display and checkout run entirely
 * on the deterministic Server Actions in `catalog-actions.ts`; the
 * conversation is the only door to the LLM, for whatever genuinely needs
 * natural-language understanding. Popular-product badges and the
 * cross-sell suggestion are both real signals from this business's own
 * order history (`getPopularityByProduct`) — never fabricated.
 */
export default async function ExternalAgentPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ table?: string }>;
}) {
  const { slug } = await params;
  const { table: rawTableId } = await searchParams;
  const tenant = await resolvePublicTenant(slug);
  if (!tenant) notFound();

  const data = await loadAgentExperience(tenant, { surface: "external_agent", rawTableId });
  if (!data.active) return <AgentInactive locale={data.locale} businessName={data.businessName} text={data.inactiveText} />;

  return (
    <AgentI18nProvider locale={data.locale} messages={data.messages.agent}>
      <AgentExperience {...data.props} />
    </AgentI18nProvider>
  );
}
