import "server-only";

import { speechSentences, type SpeechLanguage } from "@/components/agent-public/voice";
import { isLocale, type Locale } from "@/i18n/locales";
import { agentLog } from "@/server/ai/diagnostics";
import { checkAiUsage, reserveAiCall, settleAiCall } from "@/server/ai/usage-guard";
import { hashToken, readSessionToken } from "@/server/agent-public/session";
import type { PublicTenant } from "@/server/agent-public/tenant";
import { serviceClient } from "@/server/supabase/clients";

import { elevenLabsProvider } from "./elevenlabs";
import type { TtsProvider } from "./provider";
import type { AudioStore, VoiceDeps, VoiceProfile, VoiceSpend } from "./service";

/**
 * Production wiring of the voice service (./service.ts): the provider a
 * voice profile names, the private `agent-voice` Storage bucket as the audio
 * cache, and the platform's AI usage guard and interaction ledger for cost.
 */
export const VOICE_BUCKET = "agent-voice";

const PROVIDERS: Record<string, TtsProvider> = { elevenlabs: elevenLabsProvider };

export type VoiceGender = "male" | "female";

/** The active voice for a gender — only when its provider has credentials on this server. */
export async function activeVoiceProfile(gender: VoiceGender): Promise<VoiceProfile | null> {
  const { data } = await serviceClient()
    .from("voice_profiles")
    .select("id, gender, provider, voice_id, voice_name, model, price_per_million_chars_usd, settings, greeting_settings")
    .eq("gender", gender)
    .eq("is_active", true)
    .maybeSingle();
  if (!data || !PROVIDERS[data.provider]?.configured()) return null;
  return {
    id: data.id,
    gender: data.gender,
    provider: data.provider,
    voiceId: data.voice_id,
    voiceName: data.voice_name,
    model: data.model,
    pricePerMillionCharsUsd: Number(data.price_per_million_chars_usd),
    settings: data.settings ?? {},
    greetingSettings: data.greeting_settings ?? null,
  };
}

export function voiceProvider(profile: VoiceProfile): TtsProvider | null {
  return PROVIDERS[profile.provider] ?? null;
}

const bucketStore: AudioStore = {
  async read(path) {
    const { data, error } = await serviceClient().storage.from(VOICE_BUCKET).download(path);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  },
  async write(path, data) {
    const { error } = await serviceClient()
      .storage.from(VOICE_BUCKET)
      .upload(path, data, { contentType: "audio/mpeg", upsert: true, cacheControl: "31536000" });
    return !error;
  },
};

const ledgerSpend: VoiceSpend = {
  async allowed(tenantId) {
    const gate = await checkAiUsage(tenantId);
    return { allowed: !gate.blocked && !gate.trialEnded, governed: gate.governed };
  },
  reserve: (tenantId, estimateUsd) => reserveAiCall(tenantId, estimateUsd).then((r) => (r.allowed ? r : { allowed: false, reservationId: null })),
  settle: settleAiCall,
  async record(entry) {
    // Characters are recorded in input_tokens: the unit the voice provider bills by.
    const { error } = await serviceClient().rpc("record_agent_interaction", {
      p_tenant_id: entry.tenantId,
      p_request_type: "voice_tts",
      p_handled_by: "ai",
      p_deterministic_rule: null,
      p_provider: entry.provider,
      p_model: entry.model,
      p_input_tokens: entry.characters,
      p_output_tokens: 0,
      p_estimated_cost_usd: entry.costUsd,
      p_latency_ms: entry.latencyMs,
      p_success: entry.success,
      p_fallback_used: false,
      p_error_message: entry.error ?? null,
    });
    if (error) agentLog("ledger_error", { tenant_id: entry.tenantId, error_code: error.code ?? "UNKNOWN" });
    if (!entry.success) agentLog("voice_tts_error", { tenant_id: entry.tenantId, error_code: entry.error ?? "UNKNOWN" });
  },
};

export function voiceDeps(profile: VoiceProfile): VoiceDeps | null {
  const provider = voiceProvider(profile);
  return provider ? { provider, store: bucketStore, spend: ledgerSpend } : null;
}

type AgentStrings = { aiName: string; home: { hi: string }; chat: { intro: string; defaultGreeting: string } };

async function agentStrings(locale: Locale): Promise<AgentStrings> {
  return ((await import(`../../../messages/${locale}.json`)).default as { agent: AgentStrings }).agent;
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/**
 * The greeting the Agent speaks — built exactly as the Agent page shows
 * it: "Hi! I'm <assistant>." then the greeting saved in Agent settings.
 */
export async function greetingSentences(tenant: PublicTenant, locale: string): Promise<{ text: string; language: SpeechLanguage }[]> {
  const ui: Locale = isLocale(locale) ? locale : "en";
  const [{ data: settings }, strings] = await Promise.all([
    serviceClient().from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle(),
    agentStrings(ui),
  ]);
  const businessName = tenant.businessName[ui] ?? tenant.businessName[tenant.defaultLanguage] ?? Object.values(tenant.businessName)[0] ?? tenant.slug;
  const aiName = settings?.agent?.assistant_name || fill(strings.aiName, { business: businessName });
  return speechSentences([`${strings.home.hi} ${fill(strings.chat.intro, { name: aiName })}`, settings?.agent?.greeting || strings.chat.defaultGreeting], ui);
}

/**
 * A reply the Agent itself wrote in this customer's own conversation (found
 * through their session cookie) — the endpoint never speaks text a caller
 * sends, so it cannot be used to generate arbitrary audio.
 */
export async function messageSentences(
  tenant: PublicTenant,
  messageId: string,
  locale: string,
): Promise<{ text: string; language: SpeechLanguage }[] | null> {
  const token = await readSessionToken(tenant.slug);
  if (!token) return null;
  const supabase = serviceClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("session_token_hash", hashToken(token))
    .eq("status", "open")
    .maybeSingle();
  if (!conversation) return null;
  const { data: message } = await supabase
    .from("conversation_messages")
    .select("content")
    .eq("tenant_id", tenant.id)
    .eq("conversation_id", conversation.id)
    .eq("id", messageId)
    .eq("role", "assistant")
    .maybeSingle();
  return message ? speechSentences([message.content], locale) : null;
}

/** The voice a business chose in Agent settings (male unless it chose female). */
export async function tenantVoiceGender(tenantId: string): Promise<VoiceGender> {
  const { data } = await serviceClient().from("tenant_settings").select("agent").eq("tenant_id", tenantId).maybeSingle();
  return data?.agent?.voice === "female" ? "female" : "male";
}
