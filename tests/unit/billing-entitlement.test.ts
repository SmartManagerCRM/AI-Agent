import { describe, expect, it } from "vitest";

import { isEntitled, type SubscriptionSnapshot } from "@/server/billing/entitlement";

const NOW = new Date("2026-06-15T00:00:00Z");

describe("isEntitled", () => {
  it("is not entitled with no subscription at all", () => {
    expect(isEntitled(null, NOW)).toBe(false);
  });

  it("is entitled while trialing before the trial end date", () => {
    const sub: SubscriptionSnapshot = { status: "trialing", trialEndsAt: "2026-06-20T00:00:00Z", currentPeriodEnd: null };
    expect(isEntitled(sub, NOW)).toBe(true);
  });

  it("is not entitled once the trial end date has passed", () => {
    const sub: SubscriptionSnapshot = { status: "trialing", trialEndsAt: "2026-06-10T00:00:00Z", currentPeriodEnd: null };
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("is not entitled exactly at the trial end instant (boundary is exclusive)", () => {
    const sub: SubscriptionSnapshot = { status: "trialing", trialEndsAt: NOW.toISOString(), currentPeriodEnd: null };
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("is entitled while active before the current period ends", () => {
    const sub: SubscriptionSnapshot = { status: "active", trialEndsAt: "2026-01-01T00:00:00Z", currentPeriodEnd: "2026-07-01T00:00:00Z" };
    expect(isEntitled(sub, NOW)).toBe(true);
  });

  it("is not entitled once an active subscription's period has ended", () => {
    const sub: SubscriptionSnapshot = { status: "active", trialEndsAt: "2026-01-01T00:00:00Z", currentPeriodEnd: "2026-06-01T00:00:00Z" };
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("is entitled when active with no period end recorded (defensive fallback)", () => {
    const sub: SubscriptionSnapshot = { status: "active", trialEndsAt: "2026-01-01T00:00:00Z", currentPeriodEnd: null };
    expect(isEntitled(sub, NOW)).toBe(true);
  });

  it("is never entitled when past_due", () => {
    const sub: SubscriptionSnapshot = { status: "past_due", trialEndsAt: "2026-01-01T00:00:00Z", currentPeriodEnd: "2027-01-01T00:00:00Z" };
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("is never entitled when canceled", () => {
    const sub: SubscriptionSnapshot = { status: "canceled", trialEndsAt: "2026-01-01T00:00:00Z", currentPeriodEnd: "2027-01-01T00:00:00Z" };
    expect(isEntitled(sub, NOW)).toBe(false);
  });

  it("a trial that used up its conversations or AI allowance is over before its end date", () => {
    const sub: SubscriptionSnapshot = {
      status: "trialing",
      trialEndsAt: "2027-01-01T00:00:00Z",
      currentPeriodEnd: null,
      trialLimitReachedAt: "2026-06-30T00:00:00Z",
    };
    expect(isEntitled(sub, NOW)).toBe(false);
    expect(isEntitled({ ...sub, trialLimitReachedAt: null }, NOW)).toBe(true);
  });

  it("a recorded trial limit never affects a paid subscription", () => {
    const sub: SubscriptionSnapshot = {
      status: "active",
      trialEndsAt: "2026-01-01T00:00:00Z",
      currentPeriodEnd: "2027-01-01T00:00:00Z",
      trialLimitReachedAt: "2026-01-01T00:00:00Z",
    };
    expect(isEntitled(sub, NOW)).toBe(true);
  });
});
