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
      // Status only — the error body can echo the request text.
      await response.body?.cancel().catch(() => {});
      return { ok: false, error: `HTTP_${response.status}`, retryable: response.status === 429 || response.status >= 500 };
    }
    return { ok: true, audio: response.body, contentType: "audio/mpeg" };
  },
};
