import { notFound } from "next/navigation";

import { AgentAvatar } from "@/components/agent-public/agent-avatar";
import { CatalogPanel } from "@/components/agent-public/catalog-panel";
import { ChatPanel } from "@/components/agent-public/chat-panel";
import { getPopularityByProduct } from "@/server/agent-public/recommendations";
import { resolvePublicTenant } from "@/server/agent-public/tenant";
import { describeOpeningHours } from "@/server/ai/deterministic/match";
import { findActiveTable } from "@/server/commerce/tables";
import { serviceClient } from "@/server/supabase/clients";

export const dynamic = "force-dynamic";

/**
 * The standalone External Agent (addendum §14–§18, and the Customer Agent
 * Master Prompt §3-§5): a complete branded customer experience reachable
 * with **no website required** — `agent.<root>/<slug>`. Business identity,
 * products and the chat panel all read the same Business Brain / catalog
 * the console manages; there is no separate "external agent" copy of any
 * of it (addendum §20).
 *
 * On open, the greeting and the category/product browser
 * (`CatalogPanel`) are both plain server-rendered data — no AI call, no
 * `runAgentGateway` invocation, not even a cart row until the customer
 * actually adds something. Category navigation, browsing, price display
 * and checkout stay entirely inside `CatalogPanel`'s deterministic
 * Server Actions; `ChatPanel` alongside it is the only door to the LLM,
 * for whatever genuinely needs natural-language understanding. Popular-
 * product badges and the cross-sell suggestion are both real signals
 * from this business's own order history (`getPopularityByProduct`) —
 * never fabricated.
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

  const supabase = serviceClient();
  const activeTable = rawTableId ? await findActiveTable(supabase, tenant.id, rawTableId) : null;
  const [
    { data: settings },
    { data: categories },
    { data: products },
    { data: currencyRow },
    { data: aboutEntry },
    { data: paymentConfig },
    { data: branch },
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
    supabase
      .from("business_brain_entries")
      .select("content")
      .eq("tenant_id", tenant.id)
      .eq("entry_type", "about")
      .eq("status", "approved")
      .eq("is_active", true)
      .maybeSingle(),
    supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", tenant.id).maybeSingle(),
    supabase
      .from("branches")
      .select("name, phone, opening_hours")
      .eq("tenant_id", tenant.id)
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle(),
    getPopularityByProduct(supabase, tenant.id),
  ]);

  if (!settings?.agent?.active) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-xl font-semibold">{tenant.businessName[tenant.defaultLanguage] ?? tenant.slug}</h1>
        <p className="text-sm text-neutral-500">This AI Agent isn&apos;t active yet — please check back soon.</p>
      </main>
    );
  }

  const businessName =
    tenant.businessName[tenant.defaultLanguage] ?? Object.values(tenant.businessName)[0] ?? tenant.slug;
  const assistantName: string | null = settings.agent.assistant_name ?? null;
  const about = bestText(aboutEntry?.content, tenant.defaultLanguage);
  const suggestions = ["What do you recommend?", "What are your hours?", "Do you deliver?"];
  const hoursLine = describeOpeningHours(
    branch
      ? {
          name: branch.name[tenant.defaultLanguage] ?? Object.values(branch.name)[0] ?? tenant.slug,
          phone: branch.phone,
          openingHours: branch.opening_hours as Record<string, { open: string; close: string }[]>,
        }
      : null,
  );
  const popularProductIds = [...popularity.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-5 px-4 py-8 sm:px-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <AgentAvatar businessName={businessName} size={64} />
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{businessName}</h1>
          <p className="mt-0.5 text-sm font-medium text-slate-500">{assistantName || `${businessName} AI`}</p>
        </div>
        {about && <p className="max-w-md text-sm text-slate-500">{about}</p>}
        {settings.agent.greeting && <p className="max-w-md text-sm text-slate-700">{settings.agent.greeting}</p>}
        {(hoursLine || branch?.phone) && (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
            {hoursLine && <span className="rounded-full bg-slate-100 px-3 py-1">{hoursLine}</span>}
            {branch?.phone && <span className="rounded-full bg-slate-100 px-3 py-1">{branch.phone}</span>}
          </div>
        )}
        {activeTable && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
            Table {activeTable.label}
          </span>
        )}
      </header>

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
        activeTable={activeTable}
      />

      {/* The greeting already renders once, above, alongside the structured
          category browser — ChatPanel's own greeting bubble would just
          repeat it, so it gets null here. */}
      <ChatPanel
        slug={tenant.slug}
        greeting={null}
        suggestions={suggestions}
        businessName={businessName}
        assistantName={assistantName}
        currency={tenant.currency}
        currencyExponent={currencyRow?.exponent ?? 2}
        tableId={activeTable?.id ?? null}
      />

      <p className="text-center text-xs text-neutral-400">Powered by SmartManager AI Agent</p>
    </main>
  );
}

function bestText(content: unknown, locale: string): string | null {
  if (!content || typeof content !== "object") return null;
  const record = content as Record<string, unknown>;
  const value = record[locale] ?? record.en ?? record.text ?? Object.values(record)[0];
  return typeof value === "string" ? value : null;
}
