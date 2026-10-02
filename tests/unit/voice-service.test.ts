import { describe, expect, it } from "vitest";

import { speechSentences } from "@/components/agent-public/voice";
import { elevenLabsProvider, elevenLabsRequest } from "@/server/voice/elevenlabs";
import type { TtsProvider, TtsRequest } from "@/server/voice/provider";
import { sentenceAudio, voiceAudioPath, voiceCacheKey, voiceCostUsd, type VoiceDeps, type VoiceProfile } from "@/server/voice/service";

const profile: VoiceProfile = {
  id: "p1",
  gender: "male",
  provider: "fake",
  voiceId: "voice-male",
  voiceName: "Eric",
  model: "eleven_flash_v2_5",
  pricePerMillionCharsUsd: 50,
  settings: { stability: 0.5, speed: 0.97 },
};
const TENANT_A = "00000000-0000-4000-8000-00000000000a";
const TENANT_B = "00000000-0000-4000-8000-00000000000b";

function audioStream(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      for (const chunk of chunks) c.enqueue(new Uint8Array(chunk));
      c.close();
    },
  });
}

function harness(options: { allowed?: boolean; governed?: boolean; reserveAllowed?: boolean; providerOk?: boolean } = {}) {
  const store = new Map<string, Uint8Array>();
  const calls: TtsRequest[] = [];
  const spend = { reserved: [] as number[], settled: [] as number[], recorded: [] as { costUsd: number; success: boolean; characters: number }[] };
  const provider: TtsProvider = {
    key: "fake",
    configured: () => true,
    async stream(request) {
      calls.push(request);
      if (options.providerOk === false) return { ok: false, error: "HTTP_500", retryable: true };
      return { ok: true, audio: audioStream([1, 2, 3], [4, 5]), contentType: "audio/mpeg" };
    },
  };
  const deps: VoiceDeps = {
    provider,
    store: {
      read: async (path) => store.get(path) ?? null,
      write: async (path, data) => {
        store.set(path, data);
        return true;
      },
    },
    spend: {
      allowed: async () => ({ allowed: options.allowed ?? true, governed: options.governed ?? true }),
      reserve: async (_t, usd) => {
        spend.reserved.push(usd);
        return options.reserveAllowed === false ? { allowed: false, reservationId: null } : { allowed: true, reservationId: "r1" };
      },
      settle: async (_t, _r, usd) => {
        spend.settled.push(usd);
      },
      record: async (entry) => {
        spend.recorded.push(entry);
      },
    },
  };
  return { deps, store, calls, spend };
}

const read = async (stream: ReadableStream<Uint8Array>) => [...new Uint8Array(await new Response(stream).arrayBuffer())];

describe("voice service: cache first, then the provider, cost always governed", () => {
  it("first time: streams from the provider, stores the audio, settles and records the real cost", async () => {
    const { deps, store, calls, spend } = harness();
    const text = "Welcome to Roasters Café.";
    const result = await sentenceAudio(deps, { tenantId: TENANT_A, profile, language: "en", text });
    expect(result.ok && result.cached).toBe(false);
    if (!result.ok) throw new Error("expected audio");
    expect(await read(result.audio)).toEqual([1, 2, 3, 4, 5]);
    await result.done;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ text, voiceId: "voice-male", model: "eleven_flash_v2_5", language: "en" });
    const cost = voiceCostUsd(profile, text.length);
    expect(cost).toBeCloseTo((text.length / 1_000_000) * 50, 9);
    expect(spend.reserved).toEqual([cost]);
    expect(spend.settled).toEqual([cost]);
    expect(spend.recorded).toEqual([expect.objectContaining({ success: true, characters: text.length, costUsd: cost })]);
    expect([...store.keys()]).toEqual([voiceAudioPath(TENANT_A, voiceCacheKey(profile, "en", text))]);
  });

  it("repeated phrase: served from the cache — no provider call, no cost", async () => {
    const { deps, calls, spend } = harness();
    const input = { tenantId: TENANT_A, profile, language: "en" as const, text: "Your order has been confirmed." };
    const first = await sentenceAudio(deps, input);
    if (!first.ok) throw new Error("expected audio");
    await read(first.audio);
    await first.done;
    const again = await sentenceAudio(deps, input);
    expect(again.ok && again.cached).toBe(true);
    if (!again.ok) throw new Error("expected audio");
    expect(await read(again.audio)).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toHaveLength(1);
    expect(spend.recorded).toHaveLength(1);
  });

  it("the cache is per business, voice and language — never shared across businesses", async () => {
    const text = "Welcome!";
    expect(voiceAudioPath(TENANT_A, voiceCacheKey(profile, "en", text))).not.toBe(voiceAudioPath(TENANT_B, voiceCacheKey(profile, "en", text)));
    expect(voiceCacheKey(profile, "en", text)).not.toBe(voiceCacheKey({ ...profile, voiceId: "voice-female" }, "en", text));
    expect(voiceCacheKey(profile, "en", text)).not.toBe(voiceCacheKey(profile, "fr", text));
    expect(voiceCacheKey(profile, "en", text)).not.toBe(voiceCacheKey({ ...profile, settings: { stability: 0.6, speed: 0.97 } }, "en", text));
    // Same settings in another order: same audio.
    expect(voiceCacheKey(profile, "en", text)).toBe(voiceCacheKey({ ...profile, settings: { speed: 0.97, stability: 0.5 } }, "en", text));
  });

  it("plan limit reached: nothing generated, nothing spent (the page uses the device voice)", async () => {
    for (const options of [{ allowed: false }, { reserveAllowed: false }]) {
      const { deps, calls, spend } = harness(options);
      expect(await sentenceAudio(deps, { tenantId: TENANT_A, profile, language: "en", text: "Hi!" })).toEqual({ ok: false, reason: "limit" });
      expect(calls).toHaveLength(0);
      expect(spend.recorded).toHaveLength(0);
    }
  });

  it("provider failure: reservation released, failure recorded at no cost", async () => {
    const { deps, spend, store } = harness({ providerOk: false });
    expect(await sentenceAudio(deps, { tenantId: TENANT_A, profile, language: "ar", text: "أهلاً!" })).toEqual({ ok: false, reason: "provider" });
    expect(spend.settled).toEqual([0]);
    expect(spend.recorded).toEqual([expect.objectContaining({ success: false, costUsd: 0 })]);
    expect(store.size).toBe(0);
  });

  it("over-long text is cut to one sentence's worth", async () => {
    const { deps, calls } = harness({ governed: false });
    const result = await sentenceAudio(deps, { tenantId: TENANT_A, profile, language: "en", text: "a".repeat(1000) });
    if (result.ok) await result.done;
    expect(calls[0].text).toHaveLength(400);
  });
});

describe("ElevenLabs provider", () => {
  it("streams with the key in a header (never the URL), the model, language and voice settings", () => {
    const { url, init } = elevenLabsRequest(
      { text: "Bonjour !", voiceId: "abc/def", model: "eleven_flash_v2_5", language: "fr", settings: { stability: 0.5 } },
      "secret-key-123",
    );
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/abc%2Fdef/stream?output_format=mp3_44100_64");
    expect(url).not.toContain("secret");
    expect(init.headers).toMatchObject({ "xi-api-key": "secret-key-123", accept: "audio/mpeg" });
    expect(JSON.parse(String(init.body))).toEqual({ text: "Bonjour !", model_id: "eleven_flash_v2_5", language_code: "fr", voice_settings: { stability: 0.5 } });
  });

  it("not configured without a key", async () => {
    const before = process.env.ELEVENLABS_API_KEY;
    delete process.env.ELEVENLABS_API_KEY;
    expect(elevenLabsProvider.configured()).toBe(false);
    expect(await elevenLabsProvider.stream({ text: "x", voiceId: "v", model: "m", language: "en", settings: {} })).toMatchObject({ ok: false, error: "NOT_CONFIGURED" });
    if (before) process.env.ELEVENLABS_API_KEY = before;
  });
});

describe("what is spoken", () => {
  it("the greeting: each sentence with its own language (Arabic intro, English greeting)", () => {
    expect(speechSentences(["أهلاً! أنا Doudi.", "Welcome to Qahwa! Fresh coffee, ready when you are."], "ar")).toEqual([
      { text: "أهلاً! أنا Doudi.", language: "ar" },
      { text: "Welcome to Qahwa!", language: "en" },
      { text: "Fresh coffee, ready when you are.", language: "en" },
    ]);
  });
});
