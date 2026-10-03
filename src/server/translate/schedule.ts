import "server-only";

import { runTranslationQueue } from "./queue";

const EVERY_MS = 5 * 60_000;
let started = false;

/**
 * Safety net next to the after-save runs: every few minutes, translate
 * whatever is due — rows queued by imports, the Business Brain, or a save
 * whose background run was cut short (a restart), and retries.
 */
export function startTranslationSweeps(): void {
  if (started || process.env.NEXT_PHASE === "phase-production-build" || !process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  started = true;
  setTimeout(() => void runTranslationQueue(), 30_000).unref();
  setInterval(() => void runTranslationQueue(), EVERY_MS).unref();
}
