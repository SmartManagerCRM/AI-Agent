/**
 * A branch's opening hours for one day, as bookings use them. Pure:
 * unit-tested in tests/unit/branch-hours.test.ts. Mirrors the database's
 * `app.branch_opening_windows`: no hours set at all = no limit; a day
 * missing from the hours = closed; a window closing at or before it opens
 * runs past midnight.
 */
export type HoursWindow = { open: string; close: string };

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** "mon" … "sun" for a local date ("YYYY-MM-DD"). */
export function weekdayKey(date: string): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[(new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7];
}

/** That day's windows: null = the branch set no hours; [] = closed that day. */
export function dayWindows(openingHours: unknown, date: string): HoursWindow[] | null {
  if (!openingHours || typeof openingHours !== "object" || Object.keys(openingHours).length === 0) return null;
  const day = (openingHours as Record<string, unknown>)[weekdayKey(date)];
  if (!Array.isArray(day)) return [];
  return day.filter(
    (w): w is HoursWindow =>
      !!w && typeof w === "object" && /^\d{2}:\d{2}/.test(String((w as HoursWindow).open)) && /^\d{2}:\d{2}/.test(String((w as HoursWindow).close)),
  );
}

/** Does a start time ("HH:MM") fall inside the day's opening hours? */
export function timeWithin(time: string, windows: HoursWindow[] | null): boolean {
  if (windows === null) return true;
  const t = time.slice(0, 5);
  return windows.some(({ open, close }) => {
    const o = open.slice(0, 5);
    const c = close.slice(0, 5);
    return c > o ? t >= o && t < c : t >= o || t < c;
  });
}

/** "09:00–17:00" labels for a day's windows. */
export function windowLabels(windows: HoursWindow[] | null): string[] | null {
  return windows === null ? null : windows.map((w) => `${w.open.slice(0, 5)}–${w.close.slice(0, 5)}`);
}
