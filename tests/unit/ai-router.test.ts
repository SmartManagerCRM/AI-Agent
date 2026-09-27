import { beforeEach, describe, expect, it, vi } from "vitest";

import { orderModelConfigs, type ModelConfigRow } from "@/server/ai/router";

const rows: ModelConfigRow[] = [
  {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    kind: "fast",
    input_price_per_million_usd: 1,
    output_price_per_million_usd: 5,
    is_active: true,
    is_default: false,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash-lite",
    kind: "fast",
    input_price_per_million_usd: 0.1,
    output_price_per_million_usd: 0.4,
    is_active: true,
    is_default: true,
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
    kind: "agent",
    input_price_per_million_usd: 0.3,
    output_price_per_million_usd: 2.5,
    is_active: true,
    is_default: true,
  },
  {
    provider: "anthropic",
    model: "disabled-model",
    kind: "fast",
    input_price_per_million_usd: 9,
    output_price_per_million_usd: 9,
    is_active: false,
    is_default: false,
  },
];

describe("orderModelConfigs", () => {
  it("puts the default row first among active rows of the requested kind", () => {
    const ordered = orderModelConfigs(rows, "fast");
    expect(ordered.map((r) => r.model)).toEqual(["gemini-2.5-flash-lite", "claude-haiku-4-5"]);
  });

  it("excludes inactive rows", () => {
    const ordered = orderModelConfigs(rows, "fast");
    expect(ordered.some((r) => r.model === "disabled-model")).toBe(false);
  });

  it("filters by kind", () => {
    expect(orderModelConfigs(rows, "agent").map((r) => r.model)).toEqual(["gemini-2.5-flash"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(orderModelConfigs([], "fast")).toEqual([]);
  });
});

describe("pickConfiguredModel / fallbackChain (env-dependent provider wiring)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    // `.optional()` in the env schema means "absent", not "empty string" —
    // stubbing "" still fails validation, so delete the keys outright.
    delete process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("skips a provider with no credentials and falls back to the next", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key-0000000000");
    const { pickConfiguredModel } = await import("@/server/ai/router");

    const selected = pickConfiguredModel(rows, "fast");
    expect(selected?.row.provider).toBe("anthropic");
  });

  it("prefers the default row when its provider is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-00000000000000");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key-0000000000");
    const { pickConfiguredModel } = await import("@/server/ai/router");

    const selected = pickConfiguredModel(rows, "fast");
    expect(selected?.row.provider).toBe("gemini");
  });

  it("returns null when no candidate provider is configured", async () => {
    const { pickConfiguredModel } = await import("@/server/ai/router");

    expect(pickConfiguredModel(rows, "fast")).toBeNull();
  });

  it("builds a fallback chain of every configured, active candidate in order", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-gemini-key-00000000000000");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key-0000000000");
    const { fallbackChain } = await import("@/server/ai/router");

    const chain = fallbackChain(rows, "fast");
    expect(chain.map((c) => c.row.provider)).toEqual(["gemini", "anthropic"]);
  });
});
