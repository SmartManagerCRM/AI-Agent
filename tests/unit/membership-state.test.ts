import { describe, expect, it } from "vitest";

import { memberState, periodLabel } from "@/lib/membership-state";

const base = { status: "active" as const, start_date: "2026-01-01", end_date: "2026-02-01", payment_status: "paid" };

describe("membership state (derived, never stored)", () => {
  it("active, renews soon, grace, expired", () => {
    expect(memberState(base, 3, "2026-01-10")).toBe("active");
    expect(memberState(base, 3, "2026-01-26")).toBe("expiring");
    expect(memberState(base, 3, "2026-02-01")).toBe("expiring");
    expect(memberState(base, 3, "2026-02-03")).toBe("grace");
    expect(memberState(base, 3, "2026-02-05")).toBe("expired");
    expect(memberState(base, 0, "2026-02-02")).toBe("expired");
  });
  it("no expiry, upcoming, trial, paused, cancelled", () => {
    expect(memberState({ ...base, end_date: null }, 0, "2030-01-01")).toBe("active");
    expect(memberState({ ...base, start_date: "2026-03-01", end_date: "2026-04-01" }, 0, "2026-02-15")).toBe("upcoming");
    expect(memberState({ ...base, payment_status: "trial" }, 0, "2026-01-05")).toBe("trial");
    expect(memberState({ ...base, status: "paused" }, 0, "2026-03-05")).toBe("paused");
    expect(memberState({ ...base, status: "cancelled" }, 0, "2026-01-05")).toBe("cancelled");
  });
  it("labels the period", () => {
    expect(periodLabel("month", 1)).toBe("Every month");
    expect(periodLabel("month", 3)).toBe("Every 3 months");
    expect(periodLabel("none", 1)).toBe("No expiry");
  });
});
