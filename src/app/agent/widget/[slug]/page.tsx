import { notFound } from "next/navigation";

import { AgentAvatar } from "@/components/agent-public/agent-avatar";
import { CatalogPanel } from "@/components/agent-public/catalog-panel";
import { ChatPanel } from "@/components/agent-public/chat-panel";
import { getPopularityByProduct } from "@/server/agent-public/recommendations";
import { resolveWidgetTenant } from "@/server/agent-public/tenant";
import { serviceClient } from "@/server/supabase/clients";

export const dynamic = "force-dynamic";

/**
 * The embeddable widget (spec §45, Phase 10) — reachable at
 * `agent.<root>/widget/<slug>`, meant to be loaded inside the small
 * floating iframe the embed snippet
 * (`src/app/api/widget/embed/route.ts`) injects into a tenant's own
 * website, not visited directly. Same data, same `CatalogPanel`/
 * `ChatPanel` components as the standalone External Agent page
 * (`src/app/agent/[slug]/page.tsx`) — only `resolveWidgetTenant` (checks
 * `deployment_mode` for `website_widget`/`both` instead of
 * `external_agent`/`both`) and the `surface` prop threaded into both
 * panels differ, plus a compact layout sized to fit an iframe rather
 * than a full page. `next.config.ts` carries this one route's own,
 * deliberately permissive `frame-ancestors *` — every other route stays
 * `frame-ancestors 'none'`.
 */
export default async function WidgetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await resolveWidgetTenant(slug);
  if (!tenant) notFound();

  const supabase = serviceClient();
  const [
    { data: settings },
    { data: categories },
    { data: products },
    { data: currencyRow },
    { data: paymentConfig },
    popularity,
  ] = await Promise.all([
    supabase.from("tenant_settings").select("agent, checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("categories").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("position"),
    supabase
      .from("products")
      .select("id, category_id, name, price_minor")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .order("created_at"),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", tenant.id).maybeSingle(),
    getPopularityByProduct(supabase, tenant.id),
  ]);

  if (!settings?.agent?.active) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-2 bg-white px-4 text-center">
        <p className="text-sm text-neutral-500">This Agent isn&apos;t active yet.</p>
      </main>
    );
  }

  const businessName =
    tenant.businessName[tenant.defaultLanguage] ?? Object.values(tenant.businessName)[0] ?? tenant.slug;
  const assistantName: string | null = settings.agent.assistant_name ?? null;
  const suggestions = ["What do you recommend?", "What are your hours?", "Do you deliver?"];
  const popularProductIds = [...popularity.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  return (
    <main className="flex h-screen flex-col gap-3 bg-white p-3">
      <header className="flex items-center gap-2 text-center">
        <AgentAvatar businessName={businessName} size={28} />
        <div className="min-w-0 text-start">
          <h1 className="truncate text-sm font-bold tracking-tight text-slate-900">{businessName}</h1>
          {settings.agent.greeting && <p className="truncate text-xs text-neutral-500">{settings.agent.greeting}</p>}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <CatalogPanel
          slug={tenant.slug}
          locale={tenant.defaultLanguage}
          businessName={businessName}
          categories={categories ?? []}
          products={(products ?? []).map((p) => ({
            id: p.id,
            categoryId: p.category_id,
            name: p.name,
            priceMinor: p.price_minor,
          }))}
          popularProductIds={popularProductIds}
          currency={tenant.currency}
          currencyExponent={currencyRow?.exponent ?? 2}
          orderingEnabled={settings.checkout?.ordering_enabled ?? false}
          fulfillmentTypes={settings.checkout?.fulfillment_types ?? ["pickup"]}
          paymentMethods={paymentConfig?.enabled_methods ?? []}
          initialCart={null}
          surface="website_widget"
        />
      </div>

      <ChatPanel
        slug={tenant.slug}
        greeting={null}
        suggestions={suggestions}
        businessName={businessName}
        assistantName={assistantName}
        currency={tenant.currency}
        currencyExponent={currencyRow?.exponent ?? 2}
        surface="website_widget"
      />

      <p className="text-center text-[10px] text-neutral-400">Powered by SmartManager AI Agent</p>
    </main>
  );
}
