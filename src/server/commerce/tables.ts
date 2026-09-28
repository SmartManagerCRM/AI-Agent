import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type ActiveTable = { id: string; branchId: string; label: string };

/**
 * The one place a table id is ever trusted (spec §25/§39: "query
 * parameters are not trusted authorization"). A QR code's own `?table=`
 * value is just an opaque id from the client — this re-reads it against a
 * real, active `branch_tables` row scoped to this tenant every time, and
 * every dine-in write path (the `set_fulfillment` tool, the structured
 * checkout action) calls this again itself rather than trusting a value
 * merely because an earlier page render already validated it once.
 */
export async function findActiveTable(
  supabase: TypedSupabaseClient,
  tenantId: string,
  tableId: string,
): Promise<ActiveTable | null> {
  const { data, error } = await supabase
    .from("branch_tables")
    .select("id, branch_id, label")
    .eq("id", tableId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  // A malformed id (not even a UUID) errors rather than returning no rows —
  // still just "not a valid table", never a reason to throw on a public path.
  if (error || !data) return null;
  return { id: data.id, branchId: data.branch_id, label: data.label };
}
