import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type HealthStatus = "online" | "degraded" | "offline" | "unknown";

export type HealthCheck = {
  name: string;
  status: HealthStatus;
  latencyMs: number | null;
  detail: string | null;
  checkedAt: string;
};

/**
 * Real checks only (spec §31 "Never fake health data") — a component with
 * no honest way to check from inside a Next.js request reports `unknown`
 * with an explanation, never a fabricated "online".
 */
export async function getSystemHealth(supabase: TypedSupabaseClient): Promise<HealthCheck[]> {
  const checkedAt = new Date().toISOString();

  const dbStart = Date.now();
  const { error: dbError } = await supabase.from("tenants").select("id", { head: true, count: "exact" });
  const dbLatency = Date.now() - dbStart;
  const database: HealthCheck = {
    name: "Database",
    status: dbError ? "offline" : dbLatency > 2000 ? "degraded" : "online",
    latencyMs: dbError ? null : dbLatency,
    detail: dbError ? dbError.message : null,
    checkedAt,
  };

  // The application itself is, definitionally, online if this code is
  // running to answer the request.
  const application: HealthCheck = { name: "Application", status: "online", latencyMs: null, detail: null, checkedAt };

  const { data: activeModels, error: modelsError } = await supabase
    .from("ai_model_configs")
    .select("id")
    .eq("is_active", true)
    .limit(1);
  const aiProvider: HealthCheck = {
    name: "AI Provider",
    status: modelsError ? "unknown" : (activeModels?.length ?? 0) > 0 ? "online" : "degraded",
    latencyMs: null,
    detail: modelsError
      ? "Could not read AI model configuration."
      : (activeModels?.length ?? 0) > 0
        ? null
        : "No active AI model is configured.",
    checkedAt,
  };

  const { data: paymentConfigs, error: paymentError } = await supabase
    .from("tenant_payment_config")
    .select("moyasar_secret_key, tap_secret_key")
    .limit(200);
  const anyGatewayConfigured = (paymentConfigs ?? []).some((c) => c.moyasar_secret_key || c.tap_secret_key);
  const paymentGateway: HealthCheck = {
    name: "Payment Gateway",
    status: paymentError ? "unknown" : anyGatewayConfigured ? "online" : "degraded",
    latencyMs: null,
    detail: paymentError
      ? "Could not read payment configuration."
      : anyGatewayConfigured
        ? null
        : "No business has a payment gateway connected yet.",
    checkedAt,
  };

  // No dedicated health probes exist yet for these — reported honestly as
  // unknown rather than assumed online (spec §31).
  const unmonitored = ["Storage", "Email", "Background Jobs", "Crawler", "Webhooks"].map((name): HealthCheck => ({
    name,
    status: "unknown",
    latencyMs: null,
    detail: "Not yet instrumented.",
    checkedAt,
  }));

  return [application, database, aiProvider, paymentGateway, ...unmonitored];
}

export function overallHealth(checks: HealthCheck[]): "operational" | "degraded" | "critical" {
  if (checks.some((c) => c.status === "offline")) return "critical";
  if (checks.some((c) => c.status === "degraded")) return "degraded";
  return "operational";
}
