import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";
import { parseSubscriberUsage, type SubscriberUsage } from "./usage";

/**
 * The signed-in subscriber's own usage (conversations, period, grace, "AI is
 * limited") through `tenant_usage_summary`, which checks business access
 * itself and never returns AI dollar figures.
 */
export async function loadSubscriberUsage(
  supabase: TypedSupabaseClient,
  tenantId: string,
): Promise<SubscriberUsage | null> {
  const { data, error } = await supabase.rpc("tenant_usage_summary", { p_tenant_id: tenantId });
  if (error) return null;
  return parseSubscriberUsage(data);
}
