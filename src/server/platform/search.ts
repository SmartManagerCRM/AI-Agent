import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

/** `orderNumber` is set on order results so the page can word "Order #…" in the Super Admin's language. */
export type SearchResult = { id: string; title: string; subtitle: string; href: string; orderNumber?: number };
export type SearchResults = { businesses: SearchResult[]; subscribers: SearchResult[]; orders: SearchResult[] };

/**
 * Deterministic database search (spec §7) — plain `ilike`/exact-match
 * queries, never an LLM call, for ordinary exact search across the
 * platform's core entities. Every result links into a Super-Admin-only
 * page (the Business 360 detail view, or the Businesses list for an order
 * whose business can't be resolved) rather than into a tenant's own
 * subscriber console — Super Admin does not yet have a granted way to open
 * another tenant's console without weakening tenant isolation, so this
 * never links somewhere that would just redirect away.
 */
export async function searchPlatform(supabase: TypedSupabaseClient, query: string): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return { businesses: [], subscribers: [], orders: [] };

  const like = `%${q}%`;
  const orderNumber = Number(q);

  const [{ data: slugMatches }, { data: allTenants }, { data: profiles }, { data: orders }] = await Promise.all([
    supabase.from("tenants").select("id, slug, business_name").ilike("slug", like).limit(8),
    // Names in any of the platform's languages, matched in the database (every business, however many).
    supabase
      .from("tenants")
      .select("id, slug, business_name")
      .or(["en", "ar", "fr"].map((l) => `business_name->>${l}.ilike.${like.replace(/[,()]/g, " ")}`).join(","))
      .limit(8),
    supabase.from("profiles").select("id, full_name, email").or(`full_name.ilike.${like},email.ilike.${like}`).limit(8),
    Number.isInteger(orderNumber) && orderNumber > 0
      ? supabase
          .from("orders")
          .select("id, order_number, tenant_id, customer_name")
          .eq("order_number", orderNumber)
          .limit(5)
      : Promise.resolve({
          data: [] as { id: string; order_number: number; tenant_id: string; customer_name: string | null }[],
        }),
  ]);

  const nameMatches = allTenants ?? [];
  const tenantById = new Map([...(slugMatches ?? []), ...nameMatches].map((t) => [t.id, t]));

  const businesses: SearchResult[] = Array.from(tenantById.values())
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      title: t.business_name.en ?? t.slug,
      subtitle: `/${t.slug}`,
      href: `/super-admin/businesses/${t.slug}`,
    }));

  const subscribers: SearchResult[] = (profiles ?? []).map((p) => ({
    id: p.id,
    title: p.full_name ?? p.email ?? "—",
    subtitle: p.email ?? "",
    href: "/super-admin/subscribers",
  }));

  const orderTenantIds = [...new Set((orders ?? []).map((o) => o.tenant_id))];
  const { data: orderTenants } = orderTenantIds.length
    ? await supabase.from("tenants").select("id, slug").in("id", orderTenantIds)
    : { data: [] };
  const slugByTenant = new Map((orderTenants ?? []).map((t) => [t.id, t.slug]));

  const orderResults: SearchResult[] = (orders ?? []).map((o) => ({
    id: o.id,
    title: `Order #${o.order_number}`,
    orderNumber: o.order_number,
    subtitle: o.customer_name ?? "",
    href: slugByTenant.has(o.tenant_id)
      ? `/super-admin/businesses/${slugByTenant.get(o.tenant_id)}?tab=orders`
      : "/super-admin/businesses",
  }));

  return { businesses, subscribers, orders: orderResults };
}
