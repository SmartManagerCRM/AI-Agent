import { elevenLabsQuota, type ElevenLabsQuota } from "./elevenlabs";

/**
 * Is the premium voice's allowance (ElevenLabs characters — the free tier
 * included) still available? When it is used up, the whole Agent speaks
 * with each customer's own device voice (free) until the allowance resets:
 * the page is served without premium voice, and the voice endpoint answers
 * "use the device voice" at once instead of calling ElevenLabs.
 *
 * Known two ways: ElevenLabs refusing a sentence for quota, and its account
 * figures (checked at most every few minutes). This state describes the
 * platform's voice account only — it holds no business or customer data.
 */
const RECHECK_MS = 5 * 60_000;
/** When ElevenLabs refused for quota but didn't say when it resets: look again after this long. */
const EXHAUSTED_FALLBACK_MS = 30 * 60_000;

type State = { quota: ElevenLabsQuota | null; checkedAt: number; exhaustedUntil: number };
const state: State = { quota: null, checkedAt: 0, exhaustedUntil: 0 };

/** The account's allowance, refreshed at most every few minutes (null: not readable). */
export async function premiumVoiceQuota(options?: { fresh?: boolean }): Promise<ElevenLabsQuota | null> {
  const now = Date.now();
  if (options?.fresh || now - state.checkedAt > RECHECK_MS) {
    state.checkedAt = now;
    state.quota = await elevenLabsQuota(AbortSignal.timeout(5000));
    if (state.quota && state.quota.used < state.quota.limit && state.exhaustedUntil > now) {
      // More characters became available (the month reset, or the plan changed).
      state.exhaustedUntil = 0;
    }
  }
  return state.quota;
}

/** True while the premium voice can't speak: the customer's device voice is used instead. */
export async function premiumVoiceExhausted(characters = 1): Promise<boolean> {
  const now = Date.now();
  if (state.exhaustedUntil > now) {
    // Look again once in a while — the allowance may have reset early (an upgrade).
    if (now - state.checkedAt > RECHECK_MS) await premiumVoiceQuota();
    return state.exhaustedUntil > now;
  }
  const quota = await premiumVoiceQuota();
  return quota !== null && quota.used + characters > quota.limit;
}

/** ElevenLabs refused a sentence because the characters are used up. */
export function notePremiumVoiceExhausted(): void {
  const resetsAt = state.quota?.resetsAt ? Date.parse(state.quota.resetsAt) : NaN;
  state.exhaustedUntil = Number.isFinite(resetsAt) && resetsAt > Date.now() ? resetsAt : Date.now() + EXHAUSTED_FALLBACK_MS;
}

/** A sentence was generated: count its characters until the next check. */
export function notePremiumVoiceUsed(characters: number): void {
  if (state.quota) state.quota = { ...state.quota, used: state.quota.used + characters };
}

/** Tests only. */
export function resetPremiumVoiceAvailability(): void {
  state.quota = null;
  state.checkedAt = 0;
  state.exhaustedUntil = 0;
}
