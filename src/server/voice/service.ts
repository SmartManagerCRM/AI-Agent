import { createHash } from "node:crypto";

import { speechSentences, type SpeechLanguage } from "@/components/agent-public/voice";

import type { TtsProvider, VoiceLanguage, VoiceSettings } from "./provider";

/**
 * The voice service: one sentence of the Agent's speech at a time.
 *
 *   text → audio cache ── hit ──→ play the stored audio (no cost)
 *              │
 *             miss → usage guard → provider (streamed) ──→ play while it streams
 *                                        └──→ store in the cache, settle the real cost
 *
 * Every sentence is cached per business, voice, model, settings, language
 * and text, so a repeated phrase ("Welcome to Roasters Café.", "Your order
 * has been confirmed.") is generated and paid for once. The cache is per
 * business: one business's audio is never served to another.
 *
 * Everything with I/O is passed in (`VoiceDeps`), so this is unit-tested
 * without a vendor, Storage or a database.
 */
export type VoiceProfile = {
  id: string;
  gender: "male" | "female";
  provider: string;
  voiceId: string;
  voiceName: string | null;
  model: string;
  pricePerMillionCharsUsd: number;
  settings: VoiceSettings;
  /** Warmer, livelier delivery for the welcome greeting (null = the same as replies). */
  greetingSettings: VoiceSettings | null;
};

/** The profile that speaks the welcome greeting: the same voice, in its greeting delivery when one is set. */
export function greetingProfile(profile: VoiceProfile): VoiceProfile {
  return profile.greetingSettings ? { ...profile, settings: profile.greetingSettings } : profile;
}

export type AudioStore = {
  read(path: string): Promise<Uint8Array | null>;
  write(path: string, data: Uint8Array): Promise<boolean>;
};

export type VoiceSpend = {
  /** May this business spend on voice now (plan, trial and cost limits)? */
  allowed(tenantId: string): Promise<{ allowed: boolean; governed: boolean }>;
  reserve(tenantId: string, estimateUsd: number): Promise<{ allowed: boolean; reservationId: string | null }>;
  settle(tenantId: string, reservationId: string, actualUsd: number): Promise<void>;
  record(entry: {
    tenantId: string;
    provider: string;
    model: string;
    characters: number;
    costUsd: number;
    latencyMs: number;
    success: boolean;
    error?: string;
  }): Promise<void>;
};

export type VoiceDeps = { provider: TtsProvider; store: AudioStore; spend: VoiceSpend; now?: () => number };

export type SentenceAudio =
  | {
      ok: true;
      cached: boolean;
      audio: ReadableStream<Uint8Array>;
      /** Resolves once a fresh sentence is stored and its cost recorded (keep the server alive for it). */
      done: Promise<void>;
    }
  | { ok: false; reason: "limit" | "provider" | "quota" };

/** Longest sentence sent for speech (longer text is a sign of misuse, not of a sentence). */
export const MAX_SENTENCE_CHARS = 400;

/**
 * The greeting as the voice should say it: one even, friendly-professional
 * tone from the first word to the last. Generated sentence by sentence,
 * each clip got its own intonation — the short "Hi! I'm …" came out high and
 * the rest lower — so the whole greeting in one language is one recording.
 * Exclamation marks are read as full stops: they make the voice jump in
 * pitch. (The text shown on screen is not changed.)
 */
export function evenGreeting(parts: readonly string[], locale: string): { text: string; language: SpeechLanguage }[] {
  const calm = parts.map((part) => part.replace(/\s*[!¡]+/g, "."));
  const out: { text: string; language: SpeechLanguage }[] = [];
  for (const sentence of speechSentences(calm, locale)) {
    const last = out[out.length - 1];
    if (last && last.language === sentence.language && last.text.length + sentence.text.length < MAX_SENTENCE_CHARS) last.text = `${last.text} ${sentence.text}`;
    else out.push({ ...sentence });
  }
  return out;
}

export function voiceCacheKey(profile: VoiceProfile, language: VoiceLanguage, text: string): string {
  const settings = Object.keys(profile.settings)
    .sort()
    .map((k) => `${k}=${profile.settings[k]}`)
    .join("&");
  return createHash("sha256")
    .update([profile.provider, profile.voiceId, profile.model, settings, language, text].join("\u0000"))
    .digest("hex");
}

export function voiceAudioPath(tenantId: string, key: string): string {
  return `${tenantId}/${key}.mp3`;
}

export function voiceCostUsd(profile: VoiceProfile, characters: number): number {
  return Math.round((characters / 1_000_000) * profile.pricePerMillionCharsUsd * 1_000_000) / 1_000_000;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

export async function sentenceAudio(
  deps: VoiceDeps,
  input: { tenantId: string; profile: VoiceProfile; language: VoiceLanguage; text: string },
): Promise<SentenceAudio> {
  const now = deps.now ?? Date.now;
  const text = input.text.trim().slice(0, MAX_SENTENCE_CHARS);
  const path = voiceAudioPath(input.tenantId, voiceCacheKey(input.profile, input.language, text));

  const cached = await deps.store.read(path).catch(() => null);
  if (cached && cached.byteLength > 0) return { ok: true, cached: true, audio: streamOf(cached), done: Promise.resolve() };

  const gate = await deps.spend.allowed(input.tenantId);
  if (!gate.allowed) return { ok: false, reason: "limit" };
  const cost = voiceCostUsd(input.profile, text.length);
  let reservationId: string | null = null;
  if (gate.governed) {
    const reservation = await deps.spend.reserve(input.tenantId, cost);
    if (!reservation.allowed) return { ok: false, reason: "limit" };
    reservationId = reservation.reservationId;
  }

  const startedAt = now();
  const record = (success: boolean, error?: string) =>
    deps.spend.record({
      tenantId: input.tenantId,
      provider: input.profile.provider,
      model: input.profile.model,
      characters: text.length,
      // A sentence the provider accepted is billed, even if the customer stops listening.
      costUsd: success || error === "STREAM_ERROR" ? cost : 0,
      latencyMs: now() - startedAt,
      success,
      error,
    });

  // Not tied to the customer's request: a sentence that has started is billed anyway, so it is
  // always finished and cached — the next customer hearing it costs nothing.
  const result = await deps.provider.stream({
    text,
    voiceId: input.profile.voiceId,
    model: input.profile.model,
    language: input.language,
    settings: input.profile.settings,
    signal: AbortSignal.timeout(30_000),
  });
  if (!result.ok) {
    if (reservationId) await deps.spend.settle(input.tenantId, reservationId, 0);
    await record(false, result.error);
    // The voice account's characters are used up (ElevenLabs free tier included).
    return { ok: false, reason: result.error === "QUOTA_EXCEEDED" ? "quota" : "provider" };
  }

  const [toCustomer, toCache] = result.audio.tee();
  const done = (async () => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    const reader = toCache.getReader();
    try {
      for (;;) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        chunks.push(value);
        size += value.byteLength;
      }
    } catch {
      failed = true;
    }
    if (reservationId) await deps.spend.settle(input.tenantId, reservationId, cost);
    if (failed || size === 0) {
      await record(false, "STREAM_ERROR");
      return;
    }
    const audio = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.byteLength;
    }
    await deps.store.write(path, audio).catch(() => false);
    await record(true);
  })();
  return { ok: true, cached: false, audio: toCustomer, done };
}
