import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type BusinessBrainRow = {
  tenantId: string;
  slug: string;
  businessName: string;
  sourceCount: number;
  pendingReview: number;
  approvedEntries: number;
  openConflicts: number;
};

/** Cross-tenant Business Brain health (spec §98 "Business Brain platform module") — real counts, one bulk read per table. */
export async function getBusinessBrainOverview(supabase: TypedSupabaseClient): Promise<BusinessBrainRow[]> {
  const [{ data: tenants }, { data: sources }, { data: entries }, { data: conflicts }] = await Promise.all([
    supabase.from("tenants").select("id, slug, business_name").order("business_name"),
    supabase.from("business_sources").select("tenant_id"),
    supabase.from("business_brain_entries").select("tenant_id, status"),
    supabase.from("business_brain_conflicts").select("tenant_id, status").eq("status", "open"),
  ]);

  const sourceCountByTenant = new Map<string, number>();
  for (const s of sources ?? []) sourceCountByTenant.set(s.tenant_id, (sourceCountByTenant.get(s.tenant_id) ?? 0) + 1);

  const pendingByTenant = new Map<string, number>();
  const approvedByTenant = new Map<string, number>();
  for (const e of entries ?? []) {
    if (e.status === "pending_review") pendingByTenant.set(e.tenant_id, (pendingByTenant.get(e.tenant_id) ?? 0) + 1);
    if (e.status === "approved") approvedByTenant.set(e.tenant_id, (approvedByTenant.get(e.tenant_id) ?? 0) + 1);
  }

  const conflictsByTenant = new Map<string, number>();
  for (const c of conflicts ?? []) conflictsByTenant.set(c.tenant_id, (conflictsByTenant.get(c.tenant_id) ?? 0) + 1);

  return (tenants ?? []).map((tenant) => ({
    tenantId: tenant.id,
    slug: tenant.slug,
    businessName: tenant.business_name.en ?? tenant.slug,
    sourceCount: sourceCountByTenant.get(tenant.id) ?? 0,
    pendingReview: pendingByTenant.get(tenant.id) ?? 0,
    approvedEntries: approvedByTenant.get(tenant.id) ?? 0,
    openConflicts: conflictsByTenant.get(tenant.id) ?? 0,
  }));
}
