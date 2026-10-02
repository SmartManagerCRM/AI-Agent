import "server-only";

import { normalizeProductName } from "@/server/brain/discovery/facts";
import type { TypedSupabaseClient } from "@/server/supabase/clients";
import type { Database } from "@/types/database";

import { loadGoLive } from "./go-live";
import type { ImportableOffering } from "./launch";

type Tenant = Database["public"]["Tables"]["tenants"]["Row"];

/**
 * Business Brain → live catalog. Approved Brain products become real
 * catalog products (ids, prices, categories) — the structured data the
 * customer Agent browses, searches, prices and sells from. At Go live the
 * owner chooses to add them; once the Agent is live, each later approval
 * adds the newly approved ones, so "approved in the Brain" means "on the
 * live Agent". Only what `triageOfferings` accepts ever moves: a readable
 * name, a price in the business's own currency, not already listed.
 */
export async function syncApprovedProducts(supabase: TypedSupabaseClient, tenant: Tenant, locale: string): Promise<number> {
  const { data: deployment } = await supabase.from("agent_deployments").select("status").eq("tenant_id", tenant.id).maybeSingle();
  if (deployment?.status !== "published") return 0;
  const state = await loadGoLive(supabase, tenant, locale);
  const result = await importOfferings(supabase, tenant, state.offerings.importable);
  return result.ok ? result.imported : 0;
}

/**
 * Adds approved Brain products to the catalog under the owner's own RLS
 * session (`catalog.write`). Only what `triageOfferings` accepted: a
 * readable name, a price in the business's currency, not already listed.
 */
export async function importOfferings(
  supabase: TypedSupabaseClient,
  tenant: Tenant,
  offerings: ImportableOffering[],
): Promise<{ ok: true; imported: number } | { ok: false; message: string }> {
  if (offerings.length === 0) return { ok: true, imported: 0 };
  const [{ data: currency }, { data: categories }] = await Promise.all([
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase.from("categories").select("id, name").eq("tenant_id", tenant.id),
  ]);
  const exponent = currency?.exponent ?? 2;
  const lang = (name: string) => {
    if (/[؀-ۿ]/.test(name)) return "ar";
    return tenant.default_language === "ar" ? "en" : tenant.default_language;
  };

  const categoryIds = new Map<string, string>();
  for (const c of categories ?? []) {
    for (const n of Object.values(c.name ?? {})) categoryIds.set(normalizeProductName(String(n)), c.id);
  }
  for (const label of new Set(offerings.map((o) => o.category).filter((c): c is string => Boolean(c)))) {
    const key = normalizeProductName(label);
    if (!key || categoryIds.has(key)) continue;
    const { data, error } = await supabase
      .from("categories")
      .insert({ tenant_id: tenant.id, name: { [lang(label)]: label } })
      .select("id")
      .single();
    if (error || !data) return { ok: false, message: "Couldn't add your products to the catalog — you need permission to edit products." };
    categoryIds.set(key, data.id);
  }

  const rows = offerings.map((o) => ({
    tenant_id: tenant.id,
    category_id: o.category ? (categoryIds.get(normalizeProductName(o.category)) ?? null) : null,
    // Both languages when the menu shows both (a second name in the same language is ignored).
    name: o.secondaryName && lang(o.secondaryName) !== lang(o.name) ? { [lang(o.secondaryName)]: o.secondaryName, [lang(o.name)]: o.name } : { [lang(o.name)]: o.name },
    description: o.description ? { [lang(o.description)]: o.description } : {},
    price_minor: Math.round(o.priceMajor * 10 ** exponent),
    status: "active" as const,
    source: "brain" as const,
  }));
  const { error } = await supabase.from("products").insert(rows);
  if (error) return { ok: false, message: "Couldn't add your products to the catalog — you need permission to edit products." };
  return { ok: true, imported: rows.length };
}
