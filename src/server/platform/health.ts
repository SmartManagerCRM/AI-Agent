import "server-only";

import { fallbackChain, orderModelConfigs, type ModelConfigRow } from "@/server/ai/router";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

import {
  CHECK_TIMEOUT_MS,
  classifyAiProvider,
  classifyApplication,
  classifyDatabase,
  classifyPaymentGateway,
  overallHealth,
  type HealthCheck,
} from "./health-rules";

export { overallHealth, type HealthCheck, type HealthStatus, type OverallHealth } from "./health-rules";

/**
 * Real checks only (spec §31 "Never fake health data"). Every check is a
 * single lightweight read (never a scan or a count), all run in parallel,
 * each has its own response time and timestamp, and none can hang the page
 * (`CHECK_TIMEOUT_MS`). Severity rules live in `health-rules.ts`.
 *
 * About the database response time: it measures the round trip from this
 * server to Supabase, and the query itself is trivial (~0.2 ms in the
 * database), so the number is dominated by the network path. The app
 * server (Hostinger, Frankfurt) and the database (Supabase eu-central-1,
 * Frankfurt, since 2026-10-01) now share a region; before that the
 * database was in ap-northeast-2 (Seoul) and the round trip alone was
 * about 250 ms warm and 700–800 ms on a new connection. The "degraded"
 * bar stays at 2 s so only a real problem trips it.
 */
export async function getSystemHealth(supabase: TypedSupabaseClient): Promise<HealthCheck[]> {
  const [application, database, aiProvider, paymentGateway] = await Promise.all([
    checkApplication(),
    checkDatabase(supabase),
    checkAiProvider(),
    checkPaymentGateway(supabase),
  ]);

  // No health instrumentation exists for these yet, so they're reported as
  // unknown (never assumed healthy) and don't count toward the overall
  // status.
  const unmonitored = ["Storage", "Email", "Background Jobs", "Crawler", "Webhooks"].map(
    (name): HealthCheck => ({
      name,
      tier: "optional",
      status: "unknown",
      responseTimeMs: null,
      detail: "Monitoring not implemented yet.",
      checkedAt: null,
    }),
  );

  const checks = [application, database, aiProvider, paymentGateway, ...unmonitored];
  logHealth(checks);
  return checks;
}

/** Event-loop delay: how long a callback waits to run. A healthy server answers in a few ms. */
async function checkApplication(): Promise<HealthCheck> {
  const start = performance.now();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const responseTimeMs = Math.round(performance.now() - start);
  return { name: "Application", tier: "core", ...classifyApplication(responseTimeMs), responseTimeMs, checkedAt: now() };
}

async function checkDatabase(supabase: TypedSupabaseClient): Promise<HealthCheck> {
  const start = performance.now();
  let error: string | null = null;
  let timedOut = false;
  try {
    // One indexed row, no count — constant cost however large the table grows.
    const result = await supabase.from("tenants").select("id").limit(1).abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
    if (result.error) {
      timedOut = result.error.message.toLowerCase().includes("abort");
      error = result.error.message;
    }
  } catch (err) {
    timedOut = err instanceof Error && err.name === "TimeoutError";
    error = err instanceof Error ? err.message : "Database check failed.";
  }
  const responseTimeMs = Math.round(performance.now() - start);
  return {
    name: "Database",
    tier: "core",
    ...classifyDatabase({ error, timedOut, responseTimeMs }),
    responseTimeMs,
    checkedAt: now(),
  };
}

async function checkAiProvider(): Promise<HealthCheck> {
  const start = performance.now();
  let rows: ModelConfigRow[] = [];
  let error: string | null = null;
  try {
    // Same read the gateway's router makes (service role: model prices are
    // hidden from signed-in users); only the few active model rows.
    const result = await serviceClient()
      .from("ai_model_configs")
      .select("*")
      .eq("is_active", true)
      .abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
    if (result.error) error = result.error.message;
    else rows = result.data ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : "AI configuration check failed.";
  }
  const responseTimeMs = Math.round(performance.now() - start);
  const describe = (r: ModelConfigRow) => ({ provider: r.provider, model: r.model });
  return {
    name: "AI Provider",
    tier: "core",
    ...classifyAiProvider({
      error,
      orderedActive: orderModelConfigs(rows, "fast").map(describe),
      usable: fallbackChain(rows, "fast").map((m) => describe(m.row)),
    }),
    responseTimeMs,
    checkedAt: now(),
  };
}

async function checkPaymentGateway(supabase: TypedSupabaseClient): Promise<HealthCheck> {
  const start = performance.now();
  let error: string | null = null;
  let configuredBusinesses = 0;
  try {
    // Existence only: never pulls secret keys into the app just to look at them.
    const result = await supabase
      .from("tenant_payment_config")
      .select("tenant_id")
      .or("moyasar_secret_key.not.is.null,tap_secret_key.not.is.null")
      .limit(1)
      .abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
    if (result.error) error = result.error.message;
    else configuredBusinesses = result.data?.length ?? 0;
  } catch (err) {
    error = err instanceof Error ? err.message : "Payment configuration check failed.";
  }
  const responseTimeMs = Math.round(performance.now() - start);
  return {
    name: "Payment Gateway",
    tier: "optional",
    ...classifyPaymentGateway({ error, configuredBusinesses }),
    responseTimeMs,
    checkedAt: now(),
  };
}

/** One line per health evaluation in the server log: statuses and response times only, never secrets. */
function logHealth(checks: HealthCheck[]) {
  const parts = checks
    .filter((c) => c.checkedAt !== null)
    .map((c) => `${c.name.toLowerCase().replace(/\s+/g, "_")}=${c.status}(${c.responseTimeMs}ms)`);
  console.info(`[HEALTH] overall=${overallHealth(checks)} ${parts.join(" ")}`);
}

function now(): string {
  return new Date().toISOString();
}
