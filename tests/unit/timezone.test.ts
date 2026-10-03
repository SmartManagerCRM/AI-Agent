import { describe, expect, it } from "vitest";

import { businessToday, isValidTimeZone, resolveTimeZone } from "@/lib/timezone";

describe("business time zone", () => {
  it("keeps proper names", () => {
    expect(resolveTimeZone("Africa/Tunis")).toBe("Africa/Tunis");
    expect(resolveTimeZone("Asia/Riyadh")).toBe("Asia/Riyadh");
  });
  it("reads hand-typed offsets the right way round", () => {
    expect(resolveTimeZone("UTC+1")).toBe("Etc/GMT-1");
    expect(resolveTimeZone("GMT+03:00")).toBe("Etc/GMT-3");
    expect(resolveTimeZone("utc-5")).toBe("Etc/GMT+5");
    expect(resolveTimeZone("+5:30")).toBe("Asia/Kolkata");
    expect(resolveTimeZone("UTC+0")).toBe("UTC");
  });
  it("never breaks on nonsense", () => {
    expect(resolveTimeZone("Mars/Base")).toBe("UTC");
    expect(resolveTimeZone("")).toBe("UTC");
    expect(resolveTimeZone(null)).toBe("UTC");
    expect(isValidTimeZone("UTC+1")).toBe(false);
  });
  it("UTC+1 means one hour ahead of UTC", () => {
    expect(businessToday("UTC+1", new Date("2026-10-03T23:30:00Z"))).toBe("2026-10-04");
    expect(businessToday("UTC-5", new Date("2026-10-03T03:00:00Z"))).toBe("2026-10-02");
  });
});

describe("time zone picker", () => {
  it("lists real zones with their offset, including UTC", async () => {
    const { timeZoneOptions } = await import("@/lib/timezone");
    const list = timeZoneOptions(new Date("2026-01-15T12:00:00Z"));
    expect(list.find((z) => z.value === "Africa/Tunis")?.label).toBe("UTC+01:00 · Africa/Tunis");
    expect(list.find((z) => z.value === "Asia/Riyadh")?.label).toBe("UTC+03:00 · Asia/Riyadh");
    expect(list.some((z) => z.value === "UTC")).toBe(true);
    expect(list.findIndex((z) => z.value === "America/New_York")).toBeLessThan(list.findIndex((z) => z.value === "Asia/Riyadh"));
  });
});
