import { normalizeProductName } from "@/server/brain/discovery/facts";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

import type { CatalogItem } from "./import-extract";

/**
 * Adds many catalog items at once — products (with their categories) or
 * bookable services — under the caller's own session, so RLS
 * (`catalog.write`) decides; nothing here uses elevated keys.
 */

export type CatalogTenant = { id: string; currency: string; default_language: string };

export type AddOptions = {
  kind: "product" | "service";
  source: "brain" | "file_import";
  /** Products: "active" or "draft" (drafts are never shown to customers). Services: active or inactive. */
  active: (item: CatalogItem & { factKey?: string | null }) => boolean;
};

const DEFAULT_SERVICE_MINUTES = 30;

/** Normalized names already in the catalog (archived ones included when `includeArchived`). */
export async function existingCatalogNames(
  supabase: TypedSupabaseClient,
  tenantId: string,
  kind: "product" | "service",
  includeArchived: boolean,
): Promise<Set<string>> {
  const rows =
    kind === "product"
      ? (await supabase.from("products").select("name, status").eq("tenant_id", tenantId)).data?.filter(
          (p) => includeArchived || p.status !== "archived",
        )
      : (await supabase.from("bookable_services").select("name").eq("tenant_id", tenantId)).data;
  return new Set((rows ?? []).flatMap((r) => Object.values(r.name ?? {}).map((n) => normalizeProductName(String(n)))));
}

export async function addCatalogItems(
  supabase: TypedSupabaseClient,
  tenant: CatalogTenant,
  items: (CatalogItem & { factKey?: string | null })[],
  options: AddOptions,
): Promise<{ ok: true; added: number } | { ok: false; message: string }> {
  if (items.length === 0) return { ok: true, added: 0 };
  const { data: currency } = await supabase
    .from("currencies")
    .select("exponent")
    .eq("code", tenant.currency)
    .maybeSingle();
  const exponent = currency?.exponent ?? 2;
  const toMinor = (major: number | null) => (major === null ? null : Math.round(major * 10 ** exponent));
  const lang = (text: string) =>
    /[؀-ۿ]/.test(text) ? "ar" : tenant.default_language === "ar" ? "en" : tenant.default_language;
  const denied = {
    ok: false as const,
    message: "Couldn't add to your catalog — you need permission to edit products.",
  };

  if (options.kind === "service") {
    const rows = items.map((i) => ({
      tenant_id: tenant.id,
      name: { [lang(i.name)]: i.name },
      duration_minutes: i.durationMinutes ?? DEFAULT_SERVICE_MINUTES,
      price_minor: toMinor(i.priceMajor),
      is_active: options.active(i),
      source: options.source,
      brain_fact_key: i.factKey ?? null,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("bookable_services").insert(rows.slice(i, i + 200));
      if (error) return denied;
    }
    return { ok: true, added: rows.length };
  }

  // Categories: reuse by name (any language), create the missing ones.
  const { data: categories } = await supabase.from("categories").select("id, name").eq("tenant_id", tenant.id);
  const categoryIds = new Map<string, string>();
  for (const c of categories ?? []) {
    for (const n of Object.values(c.name ?? {})) categoryIds.set(normalizeProductName(String(n)), c.id);
  }
  for (const label of new Set(items.map((i) => i.category).filter((c): c is string => Boolean(c)))) {
    const key = normalizeProductName(label);
    if (!key || categoryIds.has(key)) continue;
    const { data, error } = await supabase
      .from("categories")
      .insert({ tenant_id: tenant.id, name: { [lang(label)]: label } })
      .select("id")
      .single();
    if (error || !data) return denied;
    categoryIds.set(key, data.id);
  }

  const rows = items.map((i) => ({
    tenant_id: tenant.id,
    category_id: i.category ? (categoryIds.get(normalizeProductName(i.category)) ?? null) : null,
    name: { [lang(i.name)]: i.name },
    description: i.description ? { [lang(i.description)]: i.description } : {},
    price_minor: toMinor(i.priceMajor) ?? 0,
    // A product priced only in another currency waits, as a draft, for the owner's price.
    status: options.active(i) && !i.sourcePrice ? ("active" as const) : ("draft" as const),
    source: options.source,
    brain_fact_key: i.factKey ?? null,
    source_price: i.sourcePrice ?? null,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase.from("products").insert(rows.slice(i, i + 200));
    if (error) return denied;
  }
  return { ok: true, added: rows.length };
}
