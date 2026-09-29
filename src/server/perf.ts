import { serverEnv } from "@/server/env-core";

/**
 * Opt-in `[PERF] <label>: <ms>` timing (`PERF_LOGGING=on`). Deliberately
 * not `server-only`: `src/proxy.ts` uses it too, and the proxy bundle can't
 * load that guard. Only ever logs the label, the duration and an optional
 * caller-supplied summary (a row count) — never query values.
 */
function enabled(): boolean {
  try {
    return serverEnv().PERF_LOGGING === "on";
  } catch {
    return false;
  }
}

export async function timed<T>(label: string, work: PromiseLike<T>, summarize?: (result: T) => string): Promise<T> {
  if (!enabled()) return work;
  const start = performance.now();
  try {
    const result = await work;
    const extra = summarize ? ` ${summarize(result)}` : "";
    console.log(`[PERF] ${label}: ${Math.round(performance.now() - start)}ms${extra}`);
    return result;
  } catch (error) {
    console.log(`[PERF] ${label}: ${Math.round(performance.now() - start)}ms (threw)`);
    throw error;
  }
}

/** Row-count summary for a Supabase `{ data }` result. */
export function rows(result: { data: unknown }): string {
  return Array.isArray(result.data) ? `(${result.data.length} rows)` : "";
}
