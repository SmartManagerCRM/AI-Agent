import { describe, expect, it } from "vitest";

import { calculateCostUsd } from "@/server/ai/pricing";

describe("calculateCostUsd", () => {
  it("computes cost from per-million pricing", () => {
    const cost = calculateCostUsd({ inputPricePerMillionUsd: 1, outputPricePerMillionUsd: 5 }, 1_000_000, 200_000);
    expect(cost).toBeCloseTo(1 + 1, 6);
  });

  it("rounds to six decimal places", () => {
    const cost = calculateCostUsd({ inputPricePerMillionUsd: 0.1, outputPricePerMillionUsd: 0.4 }, 37, 11);
    expect(cost).toBe(Math.round((37 * 0.1 + 11 * 0.4) / 1_000_000 * 1_000_000) / 1_000_000);
  });

  it("returns zero for zero tokens", () => {
    expect(calculateCostUsd({ inputPricePerMillionUsd: 3, outputPricePerMillionUsd: 15 }, 0, 0)).toBe(0);
  });
});
