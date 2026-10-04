import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Paddle webhook signatures: the `Paddle-Signature` header is
 * `ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<raw body>">`, keyed with the
 * notification destination's secret. While Paddle rotates a secret the header
 * may carry more than one `h1`; any matching one is accepted. A signature
 * older than `toleranceSeconds` is refused (a replayed request); a replay
 * inside the window is still harmless — each event id is applied once.
 * Pure: unit-tested in tests/unit/paddle.test.ts.
 */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

export function verifyPaddleSignature(
  rawBody: string,
  header: string | null,
  secret: string,
  now: Date = new Date(),
  toleranceSeconds: number = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  if (!header) return false;
  let ts: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const [key, value] = part.split("=", 2).map((s) => s.trim());
    if (!key || !value) continue;
    if (key === "ts" && /^\d+$/.test(value)) ts = Number(value);
    if (key === "h1" && /^[0-9a-f]{64}$/i.test(value)) signatures.push(value.toLowerCase());
  }
  if (ts === null || signatures.length === 0) return false;
  if (Math.abs(now.getTime() / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex"), "hex");
  return signatures.some((sig) => {
    const received = Buffer.from(sig, "hex");
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}

/** Signs a body the way Paddle does — for tests and local end-to-end runs only. */
export function signPaddleBody(rawBody: string, secret: string, at: Date = new Date()): string {
  const ts = Math.floor(at.getTime() / 1000);
  return `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${rawBody}`).digest("hex")}`;
}
