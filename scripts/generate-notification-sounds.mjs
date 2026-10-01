// Synthesises the console notification sounds (no external audio service):
//
//   node scripts/generate-notification-sounds.mjs
//
//   public/sounds/new-order.wav            pleasant two-note chime → short double
//                                          confirmation tone (~2.2 s, loud enough
//                                          for a counter or office)
//   public/sounds/order-reminder.wav       the same chime, softer (one reminder)
//   public/sounds/new-subscriber.wav       Super Admin: rising "success" chime
//   public/sounds/subscription-upgrade.wav Super Admin: brighter, celebratory chime
//
// Bell-like tones (a few partials with exponential decay), 16-bit mono WAV —
// played by every current browser.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RATE = 32000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** A soft bell: fundamental plus gentle harmonics, quick attack, exponential decay. */
function bell(buf, start, freq, { dur = 1.2, gain = 1, decay = 3.2, partials = [1, 0.5, 0.22, 0.12] } = {}) {
  const ratios = [1, 2, 3, 4.2];
  const s0 = Math.round(start * RATE);
  const n = Math.round(dur * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const attack = Math.min(1, t / 0.006);
    let v = 0;
    partials.forEach((a, k) => {
      // Higher partials die away faster, as in a real bell.
      v += a * Math.sin(2 * Math.PI * freq * ratios[k] * t) * Math.exp(-t * decay * (1 + k * 0.8));
    });
    buf[s0 + i] += gain * attack * v;
  }
}

/** A short, clean confirmation "pip". */
function pip(buf, start, freq, { dur = 0.13, gain = 1 } = {}) {
  const s0 = Math.round(start * RATE);
  const n = Math.round(dur * RATE);
  for (let i = 0; i < n && s0 + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.005) * Math.min(1, (dur - t) / 0.03);
    const v = Math.sin(2 * Math.PI * freq * t) + 0.25 * Math.sin(2 * Math.PI * freq * 2 * t);
    buf[s0 + i] += gain * env * v;
  }
}

function render(seconds, draw, peakDb) {
  const buf = new Float64Array(Math.round(seconds * RATE));
  draw(buf);
  // Fade the tail and normalise to the requested peak level.
  const fade = Math.round(0.15 * RATE);
  for (let i = 0; i < fade; i++) buf[buf.length - 1 - i] *= i / fade;
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const target = 10 ** (peakDb / 20);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + buf.length * 2, 4);
  pcm.write("WAVE", 8);
  pcm.write("fmt ", 12);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24);
  pcm.writeUInt32LE(RATE * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(buf.length * 2, 40);
  buf.forEach((v, i) =>
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (v / peak) * target)) * 32767), 44 + i * 2),
  );
  return pcm;
}

const A5 = 880,
  CS6 = 1108.73,
  E6 = 1318.51,
  A6 = 1760,
  C6 = 1046.5,
  G6 = 1567.98,
  C7 = 2093;

const sounds = {
  // Chime (A5 → E6), then the double confirmation tone.
  "new-order": render(
    2.2,
    (b) => {
      bell(b, 0, A5, { dur: 1.4, gain: 1 });
      bell(b, 0.22, E6, { dur: 1.4, gain: 0.85 });
      pip(b, 1.05, A6, { gain: 0.55 });
      pip(b, 1.27, A6, { gain: 0.55 });
    },
    -1,
  ),
  "order-reminder": render(
    1.6,
    (b) => {
      bell(b, 0, A5, { dur: 1.3, gain: 1, decay: 3.8 });
      bell(b, 0.22, E6, { dur: 1.3, gain: 0.8, decay: 3.8 });
    },
    -9,
  ),
  // Rising major triad: a calm "success".
  "new-subscriber": render(
    1.8,
    (b) => {
      bell(b, 0, C6, { dur: 1.4, gain: 0.9 });
      bell(b, 0.16, E6, { dur: 1.4, gain: 0.85 });
      bell(b, 0.32, G6, { dur: 1.4, gain: 0.85 });
    },
    -4,
  ),
  // Faster arpeggio up to the octave, with a light sparkle on top.
  "subscription-upgrade": render(
    2.0,
    (b) => {
      bell(b, 0, C6, { dur: 1.3, gain: 0.85 });
      bell(b, 0.1, E6, { dur: 1.3, gain: 0.8 });
      bell(b, 0.2, G6, { dur: 1.3, gain: 0.8 });
      bell(b, 0.32, C7, { dur: 1.6, gain: 0.9 });
      bell(b, 0.5, CS6 * 2, { dur: 0.9, gain: 0.25, decay: 5 });
    },
    -4,
  ),
};

const dir = path.join(root, "public/sounds");
await mkdir(dir, { recursive: true });
for (const [name, data] of Object.entries(sounds)) await writeFile(path.join(dir, `${name}.wav`), data);
console.log("sounds written");
