import { normalizeProductName } from "@/server/brain/discovery/facts";
import { isReadableName } from "@/server/brain/discovery/name-quality";
import { parseAmount } from "@/server/agent-public/launch";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

import { addCatalogItems, type CatalogTenant } from "./bulk";
import { parseDuration, type CatalogItem } from "./import-extract";

/**
 * Business Brain → catalog, the moment an analysis finishes: every product
 * and service the Brain found (and the owner hasn't rejected) appears on
 * the Products & Services and Bookings pages straight away — as a draft
 * (products) or inactive (services), never shown to customers until the
 * owner approves it in the Brain (which activates it, see the
 * `sync_brain_catalog_draft` trigger) or switches it on themselves.
 * Already-approved findings are added active. Each item is linked to its
 * Brain fact, so it is never added twice; names already in the catalog
 * (including archived ones the owner removed) are left alone.
 */
export async function draftBrainCatalog(
  supabase: TypedSupabaseClient,
  tenant: CatalogTenant,
): Promise<{ products: number; services: number; failed: boolean }> {
  const [{ data: entries }, { data: products }, { data: services }] = await Promise.all([
    supabase
      .from("business_brain_entries")
      .select("fact_key, entry_type, status, content")
      .eq("tenant_id", tenant.id)
      .in("entry_type", ["product_candidate", "service_candidate"])
      .in("status", ["pending_review", "approved"])
      .eq("is_active", true)
      .not("fact_key", "is", null)
      .limit(2000),
    supabase.from("products").select("name, brain_fact_key").eq("tenant_id", tenant.id),
    supabase.from("bookable_services").select("name, brain_fact_key").eq("tenant_id", tenant.id),
  ]);

  const known = (rows: { name: Record<string, string> | null; brain_fact_key: string | null }[] | null) => ({
    keys: new Set((rows ?? []).map((r) => r.brain_fact_key).filter(Boolean)),
    names: new Set(
      (rows ?? []).flatMap((r) => Object.values(r.name ?? {}).map((n) => normalizeProductName(String(n)))),
    ),
  });
  const existing = { product: known(products), service: known(services) };

  const picked = {
    product: [] as (CatalogItem & { factKey: string; approved: boolean })[],
    service: [] as (CatalogItem & { factKey: string; approved: boolean })[],
  };
  const seen = new Set<string>();
  for (const e of entries ?? []) {
    const kind = e.entry_type === "service_candidate" ? "service" : "product";
    const factKey = e.fact_key as string;
    if (seen.has(`${kind}:${factKey}`) || existing[kind].keys.has(factKey)) continue;
    seen.add(`${kind}:${factKey}`);
    const c = (e.content ?? {}) as {
      normalized?: { name?: unknown; amount?: unknown; currency?: unknown };
      category?: unknown;
      description?: unknown;
      duration_minutes?: unknown;
    };
    const name = typeof c.normalized?.name === "string" ? c.normalized.name.trim().slice(0, 160) : "";
    if (!name || !isReadableName(name) || existing[kind].names.has(normalizeProductName(name))) continue;
    const currency = typeof c.normalized?.currency === "string" ? c.normalized.currency.toUpperCase() : null;
    const price = parseAmount(c.normalized?.amount);
    // A price we can't sell in (unknown or another currency) is not guessed at.
    const usablePrice = price !== null && currency === tenant.currency.toUpperCase() ? price : null;
    if (kind === "product" && usablePrice === null) continue;
    const description =
      typeof c.description === "string" && c.description.trim() ? c.description.trim().slice(0, 2000) : null;
    picked[kind].push({
      factKey,
      approved: e.status === "approved",
      name,
      priceMajor: usablePrice,
      category: typeof c.category === "string" && c.category.trim() ? c.category.trim().slice(0, 120) : null,
      description,
      durationMinutes:
        typeof c.duration_minutes === "number" && c.duration_minutes >= 5 && c.duration_minutes <= 480
          ? Math.round(c.duration_minutes)
          : parseDuration(`${name} ${description ?? ""}`),
    });
    existing[kind].names.add(normalizeProductName(name));
  }

  const isApproved = (i: CatalogItem & { factKey?: string | null }) => (i as { approved?: boolean }).approved === true;
  const [p, s] = await Promise.all([
    addCatalogItems(supabase, tenant, picked.product, { kind: "product", source: "brain", active: isApproved }),
    addCatalogItems(supabase, tenant, picked.service, { kind: "service", source: "brain", active: isApproved }),
  ]);
  return { products: p.ok ? p.added : 0, services: s.ok ? s.added : 0, failed: !p.ok || !s.ok };
}
