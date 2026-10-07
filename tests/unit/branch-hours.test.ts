import { describe, expect, it } from "vitest";

import { dayWindows, timeWithin, weekdayKey, windowLabels } from "@/lib/branch-hours";

describe("a branch's hours for a day", () => {
  const hours = { mon: [{ open: "09:00", close: "17:00" }], fri: [{ open: "18:00", close: "02:00" }] };

  it("finds the weekday of a local date", () => {
    expect(weekdayKey("2026-10-05")).toBe("mon");
    expect(weekdayKey("2026-10-11")).toBe("sun");
  });

  it("reads the day's windows: none set = no limit, missing day = closed", () => {
    expect(dayWindows({}, "2026-10-05")).toBeNull();
    expect(dayWindows(null, "2026-10-05")).toBeNull();
    expect(dayWindows(hours, "2026-10-05")).toEqual([{ open: "09:00", close: "17:00" }]);
    expect(dayWindows(hours, "2026-10-06")).toEqual([]);
    expect(windowLabels(dayWindows(hours, "2026-10-05"))).toEqual(["09:00–17:00"]);
  });

  it("checks a start time against the windows, including past midnight", () => {
    const mon = dayWindows(hours, "2026-10-05");
    expect(timeWithin("09:00", mon)).toBe(true);
    expect(timeWithin("16:59", mon)).toBe(true);
    expect(timeWithin("17:00", mon)).toBe(false);
    expect(timeWithin("08:30", mon)).toBe(false);
    const fri = dayWindows(hours, "2026-10-09");
    expect(timeWithin("23:00", fri)).toBe(true);
    expect(timeWithin("01:30", fri)).toBe(true);
    expect(timeWithin("03:00", fri)).toBe(false);
    expect(timeWithin("03:00", null)).toBe(true);
    expect(timeWithin("10:00", [])).toBe(false);
  });
});
