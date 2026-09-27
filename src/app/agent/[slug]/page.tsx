import { notFound } from "next/navigation";

import { ChatPanel } from "@/components/agent-public/chat-panel";
import { resolvePublicTenant } from "@/server/agent-public/tenant";
import { serviceClient } from "@/server/supabase/clients";

export const dynamic = "force-dynamic";

/**
 * The standalone External Agent (addendum §14–§18): a complete branded
 * customer experience reachable with **no website required** —
 * `agent.<root>/<slug>`. Business identity, products and the chat panel
 * all read the same Business Brain / catalog the console manages; there is
 * no separate "external agent" copy of any of it (addendum §20).
 */
export default async function ExternalAgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const tenant = await resolvePublicTenant(slug);
  if (!tenant) notFound();

  const supabase = serviceClient();
  const [{ data: settings }, { data: products }, { data: aboutEntry }] = await Promise.all([
    supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("products").select("name, price_minor").eq("status", "active").order("created_at").limit(6),
    supabase
      .from("business_brain_entries")
      .select("content")
      .eq("tenant_id", tenant.id)
      .eq("entry_type", "about")
      .eq("status", "approved")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (!settings?.agent?.active) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-xl font-semibold">{tenant.businessName[tenant.defaultLanguage] ?? tenant.slug}</h1>
        <p className="text-sm text-neutral-500">This AI Agent isn&apos;t active yet — please check back soon.</p>
      </main>
    );
  }

  const businessName = tenant.businessName[tenant.defaultLanguage] ?? Object.values(tenant.businessName)[0] ?? tenant.slug;
  const about = bestText(aboutEntry?.content, tenant.defaultLanguage);
  const suggestions = ["Show me popular items", "What are your hours?", "Do you deliver?"];

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">{businessName.toUpperCase()}</h1>
        {about && <p className="mt-2 text-sm text-neutral-500">{about}</p>}
      </header>

      {(products ?? []).length > 0 && (
        <div className="flex flex-wrap justify-center gap-2">
          {(products ?? []).map((p, i) => (
            <span key={i} className="rounded-full border border-neutral-200 px-3 py-1 text-xs text-neutral-600">
              {p.name[tenant.defaultLanguage] ?? Object.values(p.name)[0]}
            </span>
          ))}
        </div>
      )}

      <ChatPanel slug={tenant.slug} greeting={settings.agent.greeting} suggestions={suggestions} />

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
