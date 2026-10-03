import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { notePremiumVoiceExhausted, notePremiumVoiceUsed, premiumVoiceExhausted, premiumVoiceQuota, resetPremiumVoiceAvailability } from "@/server/voice/availability";
import { elevenLabsProvider, elevenLabsQuota } from "@/server/voice/elevenlabs";
import { sentenceAudio, type VoiceDeps, type VoiceProfile } from "@/server/voice/service";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const before = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  process.env.ELEVENLABS_API_KEY = "test-key-not-real";
  resetPremiumVoiceAvailability();
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (before === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = before;
});

const request = { text: "Hello there.", voiceId: "v", model: "m", language: "en" as const, settings: {} };

describe("ElevenLabs quota", () => {
  it("a refusal for used-up characters is told apart from other errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: { status: "quota_exceeded", message: "This request exceeds your quota…" } }, 401)));
    expect(await elevenLabsProvider.stream(request)).toMatchObject({ ok: false, error: "QUOTA_EXCEEDED" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: { status: "paid_plan_required" } }, 402)));
    expect(await elevenLabsProvider.stream(request)).toMatchObject({ ok: false, error: "HTTP_402" });
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: { status: "invalid_api_key" } }, 401)));
    expect(await elevenLabsProvider.stream(request)).toMatchObject({ ok: false, error: "HTTP_401" });
  });

  it("reads the account's tier, characters and reset date", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ tier: "free", character_count: 9200, character_limit: 10000, next_character_count_reset_unix: 1793000000 })));
    expect(await elevenLabsQuota()).toEqual({ tier: "free", used: 9200, limit: 10000, resetsAt: new Date(1793000000 * 1000).toISOString() });
    vi.stubGlobal("fetch", vi.fn(async () => json({ detail: { status: "missing_permissions" } }, 401)));
    expect(await elevenLabsQuota()).toBeNull();
  });

  it("switches to the device voice when the characters run out, and back when they reset", async () => {
    let account = { tier: "free", character_count: 9990, character_limit: 10000, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 86400 };
    vi.stubGlobal("fetch", vi.fn(async () => json(account)));
    expect(await premiumVoiceExhausted(5)).toBe(false);
    // A 40-character sentence no longer fits.
    expect(await premiumVoiceExhausted(40)).toBe(true);
    notePremiumVoiceUsed(10);
    expect(await premiumVoiceExhausted(1)).toBe(true);
    // ElevenLabs refused for quota: device voice until the reset, without asking ElevenLabs on every sentence.
    notePremiumVoiceExhausted();
    expect(await premiumVoiceExhausted()).toBe(true);
    // The month resets (or the plan is upgraded): the next check brings the premium voice back.
    account = { ...account, character_count: 0 };
    await premiumVoiceQuota({ fresh: true });
    expect(await premiumVoiceExhausted()).toBe(false);
  });

  it("an unreadable allowance never blocks the voice on its own", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 401)));
    expect(await premiumVoiceExhausted()).toBe(false);
  });

  it("a quota refusal comes back as 'quota' from the voice service", async () => {
    const profile: VoiceProfile = { id: "p", gender: "male", provider: "fake", voiceId: "v", voiceName: null, model: "m", pricePerMillionCharsUsd: 50, settings: {}, greetingSettings: null };
    const deps: VoiceDeps = {
      provider: { key: "fake", configured: () => true, stream: async () => ({ ok: false, error: "QUOTA_EXCEEDED", retryable: false }) },
      store: { read: async () => null, write: async () => true },
      spend: { allowed: async () => ({ allowed: true, governed: false }), reserve: vi.fn(), settle: vi.fn(), record: async () => {} },
    };
    expect(await sentenceAudio(deps, { tenantId: "00000000-0000-4000-8000-00000000000a", profile, language: "en", text: "Hi." })).toEqual({ ok: false, reason: "quota" });
    // Not governed by the AI cost cap: nothing is reserved or settled for voice.
    expect(deps.spend.reserve).not.toHaveBeenCalled();
    expect(deps.spend.settle).not.toHaveBeenCalled();
  });
});
