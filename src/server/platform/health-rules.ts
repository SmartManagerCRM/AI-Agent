/**
 * System Health severity rules — pure functions, no I/O, so they're
 * unit-testable and the page and the overview badge can't drift apart.
 *
 * Component statuses:
 *
 *   healthy        A real check ran and the component is working within
 *                  its thresholds.
 *   degraded       A real check ran; the component works but is impaired
 *                  (slow beyond its threshold, or serving only through a
 *                  fallback).
 *   critical       A real check ran and the component cannot do its job
 *                  (no response, an error, or no usable configuration for
 *                  a core component).
 *   not_configured An optional integration nobody has set up. This is a
 *                  configuration fact, not an outage.
 *   unknown        No health monitoring is implemented for this component
 *                  yet. It says nothing about whether the component works.
 *
 * Overall platform status is computed from CORE components only:
 * application, database, AI provider. An optional integration (payments)
 * or an unmonitored component can never move the overall badge.
 *
 *   critical     any core component is critical
 *   degraded     otherwise, any core component is degraded
 *   operational  otherwise
 */

export type HealthStatus = "healthy" | "degraded" | "critical" | "not_configured" | "unknown";

export type HealthTier = "core" | "optional";

export type HealthCheck = {
  name: string;
  tier: HealthTier;
  status: HealthStatus;
  /** How long this check took to get its answer, in ms; null when nothing was measured (unmonitored components). */
  responseTimeMs: number | null;
  detail: string | null;
  /** ISO time this component was last checked; null when it isn't monitored at all. */
  checkedAt: string | null;
};

export type OverallHealth = "operational" | "degraded" | "critical";

/** Database round trip above this is "degraded". The Frankfurt→Seoul network path alone is ~250–800 ms, so a lower bar would flag geography, not a problem. */
export const DATABASE_DEGRADED_MS = 2000;
/** No answer within this is "critical" — the check is abandoned rather than left hanging. */
export const CHECK_TIMEOUT_MS = 5000;
/** Event-loop delay above this means the server is struggling to answer requests. */
export const APPLICATION_DEGRADED_MS = 500;

export function overallHealth(checks: HealthCheck[]): OverallHealth {
  const core = checks.filter((c) => c.tier === "core");
  if (core.some((c) => c.status === "critical")) return "critical";
  if (core.some((c) => c.status === "degraded")) return "degraded";
  return "operational";
}

export function classifyDatabase(result: { error: string | null; timedOut: boolean; responseTimeMs: number }): {
  status: HealthStatus;
  detail: string | null;
} {
  if (result.timedOut) return { status: "critical", detail: `No response within ${CHECK_TIMEOUT_MS / 1000}s.` };
  if (result.error) return { status: "critical", detail: result.error };
  if (result.responseTimeMs > DATABASE_DEGRADED_MS) {
    return { status: "degraded", detail: `Slow response (over ${DATABASE_DEGRADED_MS / 1000}s).` };
  }
  return { status: "healthy", detail: null };
}

export function classifyApplication(eventLoopDelayMs: number): { status: HealthStatus; detail: string | null } {
  if (eventLoopDelayMs > APPLICATION_DEGRADED_MS) {
    return { status: "degraded", detail: "The server is responding slowly (busy event loop)." };
  }
  return { status: "healthy", detail: null };
}

/**
 * AI provider availability, judged exactly the way the gateway routes a
 * request: the `fast` fallback chain (active model rows whose provider has
 * credentials) — the gateway's default kind, and the only one any caller
 * requests today.
 */
export function classifyAiProvider(input: {
  error: string | null;
  /** Active `fast` rows in the router's own order (default first). */
  orderedActive: { provider: string; model: string }[];
  /** Of those, the ones whose provider has credentials configured, same order. */
  usable: { provider: string; model: string }[];
}): { status: HealthStatus; detail: string | null } {
  if (input.error) return { status: "critical", detail: `Could not read AI model configuration: ${input.error}` };
  if (input.usable.length === 0) {
    return {
      status: "critical",
      detail:
        input.orderedActive.length === 0
          ? "No active AI model is configured — AI replies are unavailable."
          : "No active AI model has provider credentials — AI replies are unavailable.",
    };
  }
  const preferred = input.orderedActive[0];
  const serving = input.usable[0];
  if (preferred && (preferred.provider !== serving.provider || preferred.model !== serving.model)) {
    return { status: "degraded", detail: `Default model unavailable; serving through fallback ${serving.model}.` };
  }
  return { status: "healthy", detail: `Serving with ${serving.model}.` };
}

export function classifyPaymentGateway(input: { error: string | null; configuredBusinesses: number }): {
  status: HealthStatus;
  detail: string | null;
} {
  // A read failure here is the database's problem, and the database card already reports it.
  if (input.error) return { status: "unknown", detail: "Could not read payment configuration." };
  if (input.configuredBusinesses === 0) {
    return { status: "not_configured", detail: "No business has connected a payment gateway yet. Optional." };
  }
  return {
    status: "unknown",
    detail: "Configured for at least one business. Provider availability (Moyasar/Tap) isn't monitored yet.",
  };
}
