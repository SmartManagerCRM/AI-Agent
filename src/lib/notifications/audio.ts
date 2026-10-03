import { SOUND_URLS, type SoundName } from "@/lib/notifications/core";

/**
 * Notification sounds through the Web Audio API — one shared AudioContext
 * per tab, each file fetched and decoded once and reused for every alert.
 *
 * Browsers only let a page start audio after the user has interacted with
 * it. Nothing here works around that: the context is created/resumed from a
 * real user gesture (the "Enable sound" button, or any first click/tap/key
 * on the page), and until then `play` reports false so the caller shows the
 * visual alert only and says sound is not active.
 */

type Listener = () => void;

let context: AudioContext | null = null;
const files = new Map<SoundName, Promise<ArrayBuffer | null>>();
const decoded = new Map<SoundName, AudioBuffer>();
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());

export function subscribeAudio(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Audio can play right now (unlocked by a user gesture and not suspended). */
export function audioReady(): boolean {
  return context?.state === "running";
}

function fetchFile(name: SoundName): Promise<ArrayBuffer | null> {
  let file = files.get(name);
  if (!file) {
    file = fetch(SOUND_URLS[name])
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    files.set(name, file);
  }
  return file;
}

/** Downloads the sound files (once) — call when the console is idle; needs no gesture. */
export function preloadSounds(names: SoundName[]) {
  for (const name of names) void fetchFile(name);
}

async function decode(name: SoundName) {
  if (!context || decoded.has(name)) return;
  const data = await fetchFile(name);
  if (!data) return;
  try {
    // decodeAudioData detaches its input, so decode a copy and keep the original.
    decoded.set(name, await context.decodeAudioData(data.slice(0)));
  } catch {
    // Unsupported or corrupt file: alerts stay visual.
  }
}

/** Creates/resumes the audio context. Call from a user gesture. */
export async function unlockAudio(names: SoundName[]): Promise<boolean> {
  try {
    const Ctx =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return false;
    if (!context) {
      context = new Ctx();
      context.addEventListener("statechange", notify);
    }
    if (context.state !== "running") await context.resume();
    await Promise.all(names.map(decode));
  } catch {
    // Refused by the browser — stays locked.
  }
  notify();
  return audioReady();
}

/**
 * Resumes audio the phone suspended while the console was in the background
 * (no gesture needed once the page has been interacted with). True when
 * sound can play again.
 */
export async function resumeAudio(): Promise<boolean> {
  if (!context) return false;
  try {
    if (context.state !== "running") await context.resume();
  } catch {
    // Still needs a tap: the gesture listener will unlock it.
  }
  notify();
  return audioReady();
}

/** Pause between repeats of the same sound (seconds). */
const REPEAT_GAP_S = 0.35;

/**
 * Plays a sound now — `times` times back to back (all scheduled at once on
 * the audio clock, so the repeats can't drift or overlap). False if audio is
 * locked, the file failed to load, or the browser refused.
 */
export function playSound(name: SoundName, volume = 1, times = 1): boolean {
  const buffer = decoded.get(name);
  if (!context || context.state !== "running" || !buffer) {
    if (context && context.state === "suspended") void context.resume().catch(() => undefined);
    return false;
  }
  try {
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(context.destination);
    const start = context.currentTime;
    for (let i = 0; i < Math.max(1, Math.min(times, 5)); i++) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(start + i * (buffer.duration + REPEAT_GAP_S));
    }
    return true;
  } catch {
    return false;
  }
}
