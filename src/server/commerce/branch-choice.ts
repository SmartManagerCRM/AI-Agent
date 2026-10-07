import "server-only";

import type { BranchChoice } from "@/lib/branch-match";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export { matchBranch, type BranchChoice } from "@/lib/branch-match";

/**
 * Which branch a customer's order or booking goes to (multi-branch
 * businesses). The customer chooses among the branches open right now — for
 * delivery, among those that deliver; the database (`open_branches`) decides
 * which those are, from each branch's own hours in the business's time zone.
 * A business with a single open branch needs no choice; one with no branches
 * at all works as before (no branch).
 */

export type BranchPurpose = "pickup" | "delivery" | "booking";

const text = (value: unknown, locale: string): string | null => {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const v = record[locale] ?? record.en ?? Object.values(record)[0];
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

/** Does the business have branches (so the customer must end up at one)? Service role. */
export async function businessHasBranches(supabase: TypedSupabaseClient, tenantId: string): Promise<boolean> {
  const { data } = await supabase.rpc("has_active_branches", { p_tenant_id: tenantId });
  return data === true;
}

/** The branches open right now for this purpose (main branch first). Service role. */
export async function openBranchChoices(
  supabase: TypedSupabaseClient,
  tenantId: string,
  purpose: BranchPurpose,
  locale: string,
): Promise<BranchChoice[]> {
  const { data } = await supabase.rpc("open_branches", { p_tenant_id: tenantId, p_purpose: purpose });
  return (data ?? []).map((b) => ({
    id: b.id,
    name: text(b.name, locale) ?? "—",
    address: text(b.address, locale),
  }));
}
