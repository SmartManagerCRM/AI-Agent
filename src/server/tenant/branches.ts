import "server-only";

import { cache } from "react";

import { createUserClient } from "@/server/supabase/clients";

export type BranchOption = { id: string; name: string; isDefault: boolean; isActive: boolean; offersDelivery: boolean };

/** A branch's name in the console's language (else any). */
export const branchName = (name: unknown, locale: string): string => {
  const n = (name ?? {}) as Record<string, string>;
  return n[locale]?.trim() || n.en?.trim() || Object.values(n).find((v) => v?.trim())?.trim() || "—";
};

/**
 * The business's branches and the ones the signed-in member works at.
 * Owners and admins work at all of them; branch staff at theirs (the database
 * enforces the same — this only shapes the screens). Request-scoped cache.
 */
export const branchScope = cache(async (tenantId: string, locale: string) => {
  const supabase = await createUserClient();
  const [{ data: rows }, { data: mine }] = await Promise.all([
    supabase
      .from("branches")
      .select("id, name, is_default, is_active, offers_delivery, created_at")
      .eq("tenant_id", tenantId)
      .order("is_default", { ascending: false })
      .order("created_at"),
    supabase.rpc("my_branch_ids", { p_tenant_id: tenantId }),
  ]);
  const all: BranchOption[] = (rows ?? []).map((b) => ({
    id: b.id,
    name: branchName(b.name, locale),
    isDefault: b.is_default,
    isActive: b.is_active,
    offersDelivery: b.offers_delivery,
  }));
  const restricted = Array.isArray(mine) && all.length > 0;
  const allowed = (restricted ? all.filter((b) => (mine as string[]).includes(b.id)) : all).filter((b) => b.isActive);
  return {
    /** Every branch (for names). */
    all,
    /** Active branches the member may work with. */
    allowed,
    /** Limited to their own branches (branch staff). */
    restricted,
    /** A branch's name; no branch = the main branch. */
    nameOf: (id: string | null) => (id ? all.find((b) => b.id === id) : all.find((b) => b.isDefault))?.name ?? null,
  };
});
