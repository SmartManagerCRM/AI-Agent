"use server";

import { z } from "zod";

import { runAgentGateway } from "@/server/ai";
import type { AITurnMessage } from "@/server/ai/provider";
import { generateToken, hashToken, readSessionToken, writeSessionToken } from "@/server/agent-public/session";
import { resolvePublicTenant } from "@/server/agent-public/tenant";
import { serviceClient } from "@/server/supabase/clients";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const MAX_HISTORY_MESSAGES = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 20;

// In-process, best-effort per-conversation rate limit (spec §65). A single
// Node process is what this app runs as today; a real multi-instance
// deployment would need a shared store, but this still stops a runaway
// client loop from hammering the AI Gateway.
const recentMessageTimestamps = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (recentMessageTimestamps.get(key) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  recentMessageTimestamps.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_MESSAGES;
}

const sendMessageSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(1000),
});

export type SendAgentMessageState =
  | { reply: string; handledBy: "deterministic" | "ai"; message: string }
  | { error: string }
  | undefined;

/**
 * The External Agent's one server entry point (addendum §14, spec §22's
 * "external Agent customer flow"). Tenant identity comes only from the slug
 * the server itself resolved and validated; the customer's identity is only
 * the hashed session cookie — nothing here trusts anything else the client
 * sends.
 */
export async function sendAgentMessageAction(
  _prevState: SendAgentMessageState,
  formData: FormData,
): Promise<SendAgentMessageState> {
  const parsed = sendMessageSchema.safeParse({ slug: formData.get("slug"), message: formData.get("message") });
  if (!parsed.success) return { error: "Enter a message." };

  const tenant = await resolvePublicTenant(parsed.data.slug);
  if (!tenant) return { error: "This Agent is not available right now." };

  const supabase = serviceClient();
  const conversation = await getOrCreateConversation(supabase, tenant.id, tenant.slug, tenant.defaultLanguage);

  if (isRateLimited(conversation.id)) {
    return { error: "You're sending messages a little fast — please wait a moment and try again." };
  }

  const history = await loadHistory(supabase, conversation.id);

  await supabase
    .from("conversation_messages")
    .insert({ tenant_id: tenant.id, conversation_id: conversation.id, role: "user", content: parsed.data.message });

  const result = await runAgentGateway(supabase, {
    tenant: { id: tenant.id, currency: tenant.currency, slug: tenant.slug },
    locale: conversation.locale,
    requestType: "external_agent",
    message: parsed.data.message,
    history,
    conversationId: conversation.id,
  });

  await supabase.from("conversation_messages").insert({
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    role: "assistant",
    content: result.reply,
    handled_by: result.handledBy,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation.id);

  return { reply: result.reply, handledBy: result.handledBy, message: parsed.data.message };
}

async function getOrCreateConversation(
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

async function loadHistory(supabase: TypedSupabaseClient, conversationId: string): Promise<AITurnMessage[]> {
  const { data } = await supabase
    .from("conversation_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(MAX_HISTORY_MESSAGES);

  return (data ?? [])
    .slice()
    .reverse()
    .map((m) => ({ role: m.role, content: [{ type: "text" as const, text: m.content }] }));
}
