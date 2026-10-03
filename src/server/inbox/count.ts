import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Conversations with activity since this person last opened Conversations
 * (all open conversations before their first visit). Counted in Postgres.
 */
export async function newConversationCount(supabase: TypedSupabaseClient, tenantId: string, userId: string | null): Promise<number> {
  const { data: read } = userId
    ? await supabase.from("inbox_reads").select("seen_at").eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle()
    : { data: null };
  let query = supabase.from("conversations").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  query = read ? query.gt("last_message_at", read.seen_at) : query.eq("status", "open");
  const { count } = await query;
  return count ?? 0;
}
