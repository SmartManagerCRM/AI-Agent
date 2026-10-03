"use client";

/**
 * The Agent's premium voice in the browser. Audio comes from the Agent's
 * own endpoint (`/api/agent/voice`) one sentence at a time — the next
 * sentence is requested while the current one plays — and is played as it
 * streams in where the browser can (Media Source Extensions), else once
 * the sentence has arrived. Nothing here knows which vendor makes the
 * audio, and no key ever reaches the page.
 *
 * Phones only let a page play sound after a tap: `unlock()` is called from
 * inside one (the hook does it on the customer's first tap), after which
 * this same audio element may play on its own.
 */
export type VoiceSource = { kind: "greeting" } | { kind: "message"; id: string };

export type PremiumOutcome =
  | { status: "done" }
  | { status: "stopped" }
  /** `spoken`: sentences already played (the device voice says the rest); `blocked`: the browser refused to play without a tap. */
  | { status: "failed"; spoken: number; blocked: boolean };

const ENDPOINT = "/api/agent/voice";

/** A tenth of a second of silence (WAV), played inside a tap to unlock audio on phones. */
function silentWavUrl(): string {
  const samples = 800; // 0.1 s at 8 kHz, 16-bit mono
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

function once(target: EventTarget, event: string, signal: AbortSignal): Promise<Event> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      target.removeEventListener(event, onEvent);
      reject(new DOMException("Stopped", "AbortError"));
    };
    const onEvent = (e: Event) => {
      signal.removeEventListener("abort", onAbort);
      resolve(e);
    };
    target.addEventListener(event, onEvent, { once: true });
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Resolves when the clip finishes; rejects if the browser can't play it (so a reply never hangs). */
function finished(audio: HTMLAudioElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new DOMException("The audio couldn't be played", "MediaError"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Stopped", "AbortError"));
    };
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort);
  });
}

export class PremiumVoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private controller: AbortController | null = null;
  private objectUrls: string[] = [];
  private unlocked = false;
  /** The premium voice's allowance is used up: the device voice speaks for the rest of this visit. */
  exhausted = false;

  constructor(private readonly config: { slug: string; surface: "external_agent" | "website_widget"; endpoint?: string }) {}

  private element(): HTMLAudioElement {
    this.audio ??= new Audio();
    this.audio.preload = "auto";
    return this.audio;
  }

  /** Call synchronously inside a tap or key press. */
  unlock(): void {
    if (this.unlocked || typeof window === "undefined") return;
    const audio = this.element();
    const url = silentWavUrl();
    audio.src = url;
    audio
      .play()
      .then(() => {
        this.unlocked = true;
      })
      .catch(() => {})
      .finally(() => URL.revokeObjectURL(url));
  }

  /** Stops speaking at once; requests not yet answered are cancelled. */
  stop(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  private request(source: VoiceSource, locale: string, sentence: number, signal: AbortSignal): Promise<Response> {
    return fetch(this.config.endpoint ?? ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slug: this.config.slug, surface: this.config.surface, locale, source, sentence }),
      signal,
    });
  }

  async play(source: VoiceSource, locale: string, onStart?: () => void): Promise<PremiumOutcome> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    let started = false;
    const markStarted = () => {
      if (!started) {
        started = true;
        onStart?.();
      }
    };

    let total = 1;
    let pending: Promise<Response> | null = this.request(source, locale, 0, signal);
    for (let index = 0; index < total; index++) {
      let response: Response | null;
      try {
        response = await pending;
      } catch {
        response = null;
      }
      if (signal.aborted) return { status: "stopped" };
      if (!response || !response.ok || !response.body || !response.headers.get("content-type")?.includes("audio/mpeg")) {
        if (response?.headers.get("content-type")?.includes("application/json")) {
          const answer = (await response.json().catch(() => null)) as { reason?: string } | null;
          if (answer?.reason === "quota_exhausted") this.exhausted = true;
        } else await response?.body?.cancel().catch(() => {});
        return { status: "failed", spoken: index, blocked: false };
      }
      total = Math.max(1, Number(response.headers.get("x-voice-sentences")) || 1);
      // Ask for the next sentence now, so it is ready when this one ends.
      pending = index + 1 < total ? this.request(source, locale, index + 1, signal) : null;
      try {
        await this.playResponse(response, signal, markStarted);
      } catch (error) {
        if (signal.aborted) return { status: "stopped" };
        pending?.then((r) => r.body?.cancel()).catch(() => {});
        return { status: "failed", spoken: index, blocked: error instanceof DOMException && error.name === "NotAllowedError" };
      }
    }
    if (this.controller === controller) this.controller = null;
    return { status: "done" };
  }

  private async playResponse(response: Response, signal: AbortSignal, onPlaying: () => void): Promise<void> {
    const audio = this.element();
    const streaming = typeof MediaSource !== "undefined" && MediaSource.isTypeSupported("audio/mpeg");
    if (streaming) await this.playStreaming(audio, response.body!, signal, onPlaying);
    else await this.playWhole(audio, response, signal, onPlaying);
  }

  /** Plays while the sentence is still arriving. */
  private async playStreaming(audio: HTMLAudioElement, body: ReadableStream<Uint8Array>, signal: AbortSignal, onPlaying: () => void) {
    const media = new MediaSource();
    const url = URL.createObjectURL(media);
    this.objectUrls.push(url);
    audio.src = url;
    await once(media, "sourceopen", signal);
    const buffer = media.addSourceBuffer("audio/mpeg");
    const reader = body.getReader();
    const ended = finished(audio, signal);
    ended.catch(() => {});
    let playing: Promise<void> | null = null;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (signal.aborted) throw new DOMException("Stopped", "AbortError");
        if (done) break;
        buffer.appendBuffer(value as Uint8Array<ArrayBuffer>);
        await once(buffer, "updateend", signal);
        // Start as soon as there is audio — without waiting: playback needs the next chunks appended.
        if (!playing) {
          playing = audio.play().then(onPlaying);
          playing.catch(() => {});
        }
      }
      if (media.readyState === "open") media.endOfStream();
      if (!playing) return; // empty sentence
      await playing;
      await ended;
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  /** Plays once the whole sentence has arrived (browsers without streaming playback, e.g. iPhone). */
  private async playWhole(audio: HTMLAudioElement, response: Response, signal: AbortSignal, onPlaying: () => void) {
    const blob = await response.blob();
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
    const url = URL.createObjectURL(blob);
    this.objectUrls.push(url);
    audio.src = url;
    const ended = finished(audio, signal);
    ended.catch(() => {});
    await audio.play();
    onPlaying();
    await ended;
  }
}
