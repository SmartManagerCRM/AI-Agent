import { describe, expect, it } from "vitest";

import {
  classifyAiProvider,
  classifyApplication,
  classifyDatabase,
  classifyPaymentGateway,
  overallHealth,
  type HealthCheck,
  type HealthStatus,
  type HealthTier,
} from "@/server/platform/health-rules";

const check = (name: string, tier: HealthTier, status: HealthStatus): HealthCheck => ({
  name,
  tier,
  status,
  responseTimeMs: status === "unknown" ? null : 10,
  detail: null,
  checkedAt: status === "unknown" ? null : new Date().toISOString(),
});

const unmonitored = ["Storage", "Email", "Background Jobs", "Crawler", "Webhooks"].map((n) => check(n, "optional", "unknown"));

describe("overallHealth", () => {
  it("is operational when core components are healthy, whatever optional/unmonitored ones report", () => {
    const checks = [
      check("Application", "core", "healthy"),
      check("Database", "core", "healthy"),
      check("AI Provider", "core", "healthy"),
      check("Payment Gateway", "optional", "not_configured"),
      ...unmonitored,
    ];
    expect(overallHealth(checks)).toBe("operational");
  });

  it("never lets an optional component degrade the platform", () => {
    const checks = [
      check("Application", "core", "healthy"),
      check("Database", "core", "healthy"),
      check("AI Provider", "core", "healthy"),
      check("Payment Gateway", "optional", "degraded"),
      check("Email", "optional", "critical"),
    ];
    expect(overallHealth(checks)).toBe("operational");
  });

  it("is degraded or critical from core components, critical winning", () => {
    expect(overallHealth([check("Database", "core", "degraded"), check("AI Provider", "core", "healthy")])).toBe("degraded");
    expect(overallHealth([check("Database", "core", "degraded"), check("AI Provider", "core", "critical")])).toBe("critical");
  });
});

describe("classifyDatabase", () => {
  it("treats the production 818 ms round trip as healthy (network distance, not a fault)", () => {
    expect(classifyDatabase({ error: null, timedOut: false, responseTimeMs: 818 }).status).toBe("healthy");
  });
  it("is degraded above 2 s and critical on error or timeout", () => {
    expect(classifyDatabase({ error: null, timedOut: false, responseTimeMs: 2500 }).status).toBe("degraded");
    expect(classifyDatabase({ error: "connection refused", timedOut: false, responseTimeMs: 40 }).status).toBe("critical");
    expect(classifyDatabase({ error: "aborted", timedOut: true, responseTimeMs: 5000 }).status).toBe("critical");
  });
});

describe("classifyApplication", () => {
  it("is healthy with a responsive event loop and degraded when it's blocked", () => {
    expect(classifyApplication(2).status).toBe("healthy");
    expect(classifyApplication(900).status).toBe("degraded");
  });
});

describe("classifyAiProvider", () => {
  const flashLite = { provider: "gemini", model: "gemini-2.5-flash-lite" };
  const haiku = { provider: "anthropic", model: "claude-haiku-4-5" };

  it("is healthy when the default fast model is usable", () => {
    expect(classifyAiProvider({ error: null, orderedActive: [flashLite, haiku], usable: [flashLite, haiku] }).status).toBe("healthy");
  });
  it("is degraded when only a fallback model is usable", () => {
    const result = classifyAiProvider({ error: null, orderedActive: [flashLite, haiku], usable: [haiku] });
    expect(result.status).toBe("degraded");
    expect(result.detail).toContain("claude-haiku-4-5");
  });
  it("is critical when nothing can serve AI replies", () => {
    expect(classifyAiProvider({ error: null, orderedActive: [flashLite], usable: [] }).status).toBe("critical");
    expect(classifyAiProvider({ error: null, orderedActive: [], usable: [] }).status).toBe("critical");
    expect(classifyAiProvider({ error: "timeout", orderedActive: [], usable: [] }).status).toBe("critical");
  });
});

describe("classifyPaymentGateway", () => {
  it("reports 'not configured' (not degraded) when no business has a gateway", () => {
    expect(classifyPaymentGateway({ error: null, configuredBusinesses: 0 }).status).toBe("not_configured");
  });
  it("reports unknown when configured, since provider availability isn't monitored", () => {
    expect(classifyPaymentGateway({ error: null, configuredBusinesses: 1 }).status).toBe("unknown");
  });
});
