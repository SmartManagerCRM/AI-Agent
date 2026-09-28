import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type PlatformLeadRow = {
  id: string;
  tenantId: string;
  slug: string;
  businessName: string;
  customerName: string | null;
  message: string;
  status: string;
  createdAt: string;
};

/** Cross-tenant leads (Super Admin gap this session's own Phase 8 report flagged as blocked pending real lead data — now real, via Customer Agent Phase 2's capture_lead tool). */
export async function getPlatformLeads(supabase: TypedSupabaseClient, limit = 200): Promise<PlatformLeadRow[]> {
  const { data: leads } = await supabase
    .from("leads")
    .select("id, tenant_id, customer_name, message, status, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  const tenantIds = [...new Set((leads ?? []).map((l) => l.tenant_id))];
  const { data: tenants } = tenantIds.length
    ? await supabase.from("tenants").select("id, slug, business_name").in("id", tenantIds)
    : { data: [] };
  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));

  return (leads ?? []).map((l) => {
    const tenant = tenantById.get(l.tenant_id);
    return {
      id: l.id,
      tenantId: l.tenant_id,
      slug: tenant?.slug ?? "",
      businessName: tenant?.business_name.en ?? tenant?.slug ?? "—",
      customerName: l.customer_name,
      message: l.message,
      status: l.status,
      createdAt: l.created_at,
    };
  });
}
