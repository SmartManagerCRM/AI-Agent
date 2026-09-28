"use server";

import { z } from "zod";

import { runAgentGateway } from "@/server/ai";
import { AGENT_MODALITY_TEXT } from "@/server/ai/channel";
import type { AITurnMessage } from "@/server/ai/provider";
import { getOrCreateConversation } from "@/server/agent-public/conversation";
import { resolvePublicTenant, resolveWidgetTenant } from "@/server/agent-public/tenant";
import { isRateLimited } from "@/server/shared/rate-limit";
import type { CartView } from "@/server/commerce/cart";
import { serviceClient } from "@/server/supabase/clients";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const MAX_HISTORY_MESSAGES = 12;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 20;

const sendMessageSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  message: z.string().trim().min(1).max(1000),
  surface: z.enum(["external_agent", "website_widget"]).default("external_agent"),
});

export type SendAgentMessageState =
  | { reply: string; handledBy: "deterministic" | "ai"; message: string; cart?: CartView | null }
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
  const parsed = sendMessageSchema.safeParse({
    slug: formData.get("slug"),
    message: formData.get("message"),
    surface: formData.get("surface") ?? undefined,
  });
  if (!parsed.success) return { error: "Enter a message." };

  const isWidget = parsed.data.surface === "website_widget";
  const tenant = await (isWidget ? resolveWidgetTenant(parsed.data.slug) : resolvePublicTenant(parsed.data.slug));
  if (!tenant) return { error: "This Agent is not available right now." };

  const supabase = serviceClient();
  const conversation = await getOrCreateConversation(supabase, tenant.id, tenant.slug, tenant.defaultLanguage, {
    channel: parsed.data.surface,
    crossSite: isWidget,
  });

  if (isRateLimited(conversation.id, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_MESSAGES)) {
    return { error: "You're sending messages a little fast — please wait a moment and try again." };
  }

  const history = await loadHistory(supabase, conversation.id);

  await supabase.from("conversation_messages").insert({
    tenant_id: tenant.id,
    conversation_id: conversation.id,
    role: "user",
    content: parsed.data.message,
    modality: AGENT_MODALITY_TEXT,
  });

  const result = await runAgentGateway(supabase, {
    tenant: { id: tenant.id, currency: tenant.currency, slug: tenant.slug },
    locale: conversation.locale,
    requestType: parsed.data.surface,
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
    modality: AGENT_MODALITY_TEXT,
  });
  await supabase.from("conversations").update({ last_message_at: new Date().toISOString() }).eq("id", conversation.id);

  return {
    reply: result.reply,
    handledBy: result.handledBy,
    message: parsed.data.message,
    cart: "cart" in result ? (result.cart ?? null) : null,
  };
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
