import "server-only";

import type { ElevenLabsQuota } from "@/server/voice/elevenlabs";
import { premiumVoiceExhausted, premiumVoiceQuota } from "@/server/voice/availability";

export type VoiceAccount = {
  quota: ElevenLabsQuota | null;
  /** On ElevenLabs' free tier: the voice costs nothing (estimates show what paid rates would be). */
  free: boolean;
  /** The allowance is used up: every Agent speaks with the customer's device voice until it resets. */
  exhausted: boolean;
};

/** The platform's premium voice account (ElevenLabs), for Super Admin pages. */
export async function loadVoiceAccount(): Promise<VoiceAccount> {
  const quota = await premiumVoiceQuota();
  return { quota, free: (quota?.tier ?? "free") === "free", exhausted: await premiumVoiceExhausted() };
}
