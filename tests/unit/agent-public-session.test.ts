import { describe, expect, it } from "vitest";

import { generateToken, hashToken, sessionCookieName } from "@/server/agent-public/session";

describe("session tokens", () => {
  it("generates a long, high-entropy hex token", () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(generateToken()).not.toBe(token);
  });

  it("hashes the same token to the same value, deterministically", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("hashes different tokens to different values", () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });

  it("never returns the raw token as its own hash", () => {
    const token = "a".repeat(64);
    expect(hashToken(token)).not.toBe(token);
  });

  it("scopes the cookie name per tenant slug", () => {
    expect(sessionCookieName("roasters-cafe")).toBe("sma_agent_roasters-cafe");
    expect(sessionCookieName("coffeehouse")).not.toBe(sessionCookieName("roasters-cafe"));
  });
});
