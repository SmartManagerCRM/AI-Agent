/**
 * In-process, best-effort rate limiting (spec §65, Phase 11 hardening).
 * A single Node process is what this app runs as today; a real
 * multi-instance deployment would need a shared store (Redis, or
 * Supabase itself), but this still stops a runaway client loop or a
 * scripted attacker from hammering any one endpoint. Pure in-memory
 * state — no I/O — so every caller gets the exact same tested behavior
 * instead of each hand-rolling its own window/counter logic (as
 * `src/server/agent-public/actions.ts` did before this module existed).
 */
const buckets = new Map<string, number[]>();

export function isRateLimited(key: string, windowMs: number, maxHits: number): boolean {
  const now = Date.now();
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
  return hits.length > maxHits;
}
