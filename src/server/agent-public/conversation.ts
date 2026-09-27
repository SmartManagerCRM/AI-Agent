import "server-only";

import { generateToken, hashToken, readSessionToken, writeSessionToken } from "@/server/agent-public/session";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Resolves (or starts) the anonymous customer's conversation from their
 * hashed session cookie — shared by every External Agent entry point:
 * the free-text chat (`src/server/agent-public/actions.ts`) and the
 * deterministic structured-browsing actions
 * (`src/server/agent-public/catalog-actions.ts`) both call this so a
 * customer's cart is the same one regardless of which surface they used
 * to build it.
 */
export async function getOrCreateConversation(
  supabase: TypedSupabaseClient,
  tenantId: string,
  tenantSlug: string,
  defaultLocale: string,
) {
  const existingToken = await readSessionToken(tenantSlug);
  if (existingToken) {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("session_token_hash", hashToken(existingToken))
      .eq("status", "open")
      .maybeSingle();
    if (data) return data;
  }

  const token = generateToken();
  const { data, error } = await supabase
    .from("conversations")
    .insert({
      tenant_id: tenantId,
      session_token_hash: hashToken(token),
      channel: "external_agent",
      locale: defaultLocale,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error("Failed to start a conversation.");

  await writeSessionToken(tenantSlug, token);
  return data;
}
