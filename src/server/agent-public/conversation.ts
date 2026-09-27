import "server-only";

import { generateToken, hashToken, readSessionToken, writeSessionToken } from "@/server/agent-public/session";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Resolves (or starts) the anonymous customer's conversation from their
 * hashed session cookie — shared by every Agent entry point: the
 * free-text chat (`src/server/agent-public/actions.ts`) and the
 * deterministic structured-browsing actions
 * (`src/server/agent-public/catalog-actions.ts`) both call this so a
 * customer's cart is the same one regardless of which surface they used
 * to build it.
 *
 * `channel` only matters for a *new* conversation's own record of where
 * it started (`conversations.channel`) — an existing conversation keeps
 * whatever it was first created with. The widget page
 * (`src/app/agent/widget/[slug]/page.tsx`) passes `"website_widget"` and
 * `crossSite: true`: its cookie is set from an iframe on the tenant's own
 * (third-party, from the browser's view) website, which needs
 * `SameSite=None` to survive at all — the standalone External Agent is
 * always same-site, so it keeps the stricter `SameSite=Lax` default.
 */
export async function getOrCreateConversation(
  supabase: TypedSupabaseClient,
  tenantId: string,
  tenantSlug: string,
  defaultLocale: string,
  options?: { channel?: "external_agent" | "website_widget"; crossSite?: boolean },
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
      channel: options?.channel ?? "external_agent",
      locale: defaultLocale,
    })
    .select("*")
    .single();
  if (error || !data) throw new Error("Failed to start a conversation.");

  await writeSessionToken(tenantSlug, token, { crossSite: options?.crossSite });
  return data;
}
