import type { TtsProvider, TtsRequest, TtsStream } from "./provider";

/**
 * ElevenLabs text-to-speech, streamed: audio is passed on chunk by chunk as
 * ElevenLabs generates it, so a customer hears the first words before the
 * sentence is finished. The API key is read on the server only and sent
 * only to ElevenLabs.
 *
 * No `import "server-only"` (like ../ai/gemini.ts): unit-testable under
 * Vitest with a fake `fetch`.
 */
const API = "https://api.elevenlabs.io/v1/text-to-speech";
/** MP3, 44.1 kHz, 64 kbps: clear speech at half the bytes of the default 128 kbps. */
export const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_64";

function apiKey(): string | undefined {
  return process.env.ELEVENLABS_API_KEY || undefined;
}

export function elevenLabsRequest(request: TtsRequest, key: string): { url: string; init: RequestInit } {
  return {
    url: `${API}/${encodeURIComponent(request.voiceId)}/stream?output_format=${ELEVENLABS_OUTPUT_FORMAT}`,
    init: {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({
        text: request.text,
        model_id: request.model,
        // Enforces the language (and its text normalisation) instead of letting the model guess.
        language_code: request.language,
        voice_settings: request.settings,
      }),
      signal: request.signal,
    },
  };
}

/** ElevenLabs says the account's characters are used up (free tier included): {"detail": {"status": "quota_exceeded", …}}. */
async function isQuotaError(response: Response): Promise<boolean> {
  try {
    const body = (await response.json()) as { detail?: { status?: unknown } };
    const status = typeof body?.detail?.status === "string" ? body.detail.status : "";
    return /quota|credit|character_limit|exceeds_limit/i.test(status);
  } catch {
    return false;
  }
}

export type ElevenLabsQuota = {
  /** "free", "starter", … */
  tier: string | null;
  /** Characters used / allowed in the current monthly cycle. */
  used: number;
  limit: number;
  /** When the monthly characters reset (ISO), when ElevenLabs says. */
  resetsAt: string | null;
};

/**
 * The account's character allowance (GET /v1/user/subscription). Null when
 * it can't be read — no key, a key without the "User: read" permission, or
 * ElevenLabs unreachable.
 */
export async function elevenLabsQuota(signal?: AbortSignal): Promise<ElevenLabsQuota | null> {
  const key = apiKey();
  if (!key) return null;
  try {
    const response = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": key }, signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    const s = (await response.json()) as { tier?: unknown; character_count?: unknown; character_limit?: unknown; next_character_count_reset_unix?: unknown };
    const used = Number(s.character_count);
    const limit = Number(s.character_limit);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
    const reset = Number(s.next_character_count_reset_unix);
    return {
      tier: typeof s.tier === "string" ? s.tier : null,
      used,
      limit,
      resetsAt: Number.isFinite(reset) && reset > 0 ? new Date(reset * 1000).toISOString() : null,
    };
  } catch {
    return null;
  }
}

export const elevenLabsProvider: TtsProvider = {
  key: "elevenlabs",
  configured: () => !!apiKey(),
  async stream(request): Promise<TtsStream> {
    const key = apiKey();
    if (!key) return { ok: false, error: "NOT_CONFIGURED", retryable: false };
    const { url, init } = elevenLabsRequest(request, key);
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (request.signal?.aborted) return { ok: false, error: "ABORTED", retryable: false };
      return { ok: false, error: `NETWORK: ${error instanceof Error ? error.name : "error"}`, retryable: true };
    }
    if (!response.ok || !response.body) {
      // Only the error's status code is read — never its message, which can echo the request text.
      const quota = (response.status === 401 || response.status === 402 || response.status === 429) && (await isQuotaError(response));
      if (!quota) await response.body?.cancel().catch(() => {});
      if (quota) return { ok: false, error: "QUOTA_EXCEEDED", retryable: false };
      return { ok: false, error: `HTTP_${response.status}`, retryable: response.status === 429 || response.status >= 500 };
    }
    return { ok: true, audio: response.body, contentType: "audio/mpeg" };
  },
};
