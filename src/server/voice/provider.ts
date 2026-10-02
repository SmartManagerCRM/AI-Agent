/**
 * The voice service's provider contract. The Agent Engine and the Agent
 * page never talk to a speech vendor: they ask the voice service
 * (./service.ts) for a sentence of audio, and the service asks whichever
 * `TtsProvider` the active voice profile names. Adding or swapping a vendor
 * is a new implementation of this type and a `voice_profiles` row — nothing
 * else changes.
 */
export type VoiceLanguage = "en" | "ar" | "fr";

/** Voice delivery settings, as stored on the profile (provider-specific keys are passed through). */
export type VoiceSettings = Record<string, number | boolean>;

export type TtsRequest = {
  text: string;
  voiceId: string;
  model: string;
  language: VoiceLanguage;
  settings: VoiceSettings;
  /** Aborts the provider request (the customer stopped or interrupted the Agent). */
  signal?: AbortSignal;
};

export type TtsStream =
  | { ok: true; audio: ReadableStream<Uint8Array>; contentType: "audio/mpeg" }
  | { ok: false; error: string; retryable: boolean };

export type TtsProvider = {
  key: string;
  /** Credentials present on this server. */
  configured(): boolean;
  /** Streams MP3 audio for one sentence as the provider produces it. */
  stream(request: TtsRequest): Promise<TtsStream>;
};
