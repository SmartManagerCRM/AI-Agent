import { describe, expect, it } from "vitest";

import { isRateLimited } from "@/server/shared/rate-limit";

describe("isRateLimited", () => {
  it("allows hits up to the max within the window", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect(isRateLimited(key, 60_000, 5)).toBe(false);
    }
  });

  it("blocks once the max is exceeded within the window", () => {
    const key = `test-${Math.random()}`;
    for (let i = 0; i < 5; i++) isRateLimited(key, 60_000, 5);
    expect(isRateLimited(key, 60_000, 5)).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    for (let i = 0; i < 5; i++) isRateLimited(keyA, 60_000, 5);
    expect(isRateLimited(keyA, 60_000, 5)).toBe(true);
    expect(isRateLimited(keyB, 60_000, 5)).toBe(false);
  });

  it("resets once hits age out of the window", async () => {
    const key = `test-${Math.random()}`;
    const windowMs = 20;
    for (let i = 0; i < 3; i++) isRateLimited(key, windowMs, 3);
    expect(isRateLimited(key, windowMs, 3)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, windowMs + 10));
    expect(isRateLimited(key, windowMs, 3)).toBe(false);
  });
});
