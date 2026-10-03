/**
 * The business's time zone, as something date code can always use.
 * A proper name ("Africa/Tunis") is used as is. An offset typed by hand
 * ("UTC+1", "GMT+01:00", "+3") becomes the matching fixed zone — note the
 * Etc/GMT names have the opposite sign: UTC+1 is "Etc/GMT-1". Anything
 * unreadable falls back to UTC instead of breaking the page.
 */
const HALF_HOUR_ZONES: Record<string, string> = {
  "+03:30": "Asia/Tehran",
  "+04:30": "Asia/Kabul",
  "+05:30": "Asia/Kolkata",
  "+05:45": "Asia/Kathmandu",
  "+06:30": "Asia/Yangon",
  "+09:30": "Australia/Darwin",
  "-03:30": "America/St_Johns",
  "-09:30": "Pacific/Marquesas",
};

export function isValidTimeZone(name: string): boolean {
  if (!name) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimeZone(raw: string | null | undefined): string {
  const value = (raw ?? "").trim();
  if (!value) return "UTC";
  const offset = /^(?:utc|gmt)?\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(value);
  if (offset) {
    const [, sign, h, m = "00"] = offset;
    const hours = Number(h);
    if (m === "00" && hours <= 14) return hours === 0 ? "UTC" : `Etc/GMT${sign === "+" ? "-" : "+"}${hours}`;
    return HALF_HOUR_ZONES[`${sign}${String(hours).padStart(2, "0")}:${m}`] ?? "UTC";
  }
  return isValidTimeZone(value) ? value : "UTC";
}

/** Today's date ("YYYY-MM-DD") where the business is. */
export function businessToday(raw: string | null | undefined, now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: resolveTimeZone(raw) }).format(now);
}

/** Every time zone, labelled with its current UTC offset ("UTC+01:00 · Africa/Tunis"), east to west. For the Settings picker. */
export function timeZoneOptions(now = new Date()): { value: string; label: string }[] {
  const names = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["UTC"];
  const withOffset = names.map((name) => {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: name, timeZoneName: "longOffset" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value;
    const offset = part === "GMT" || !part ? "+00:00" : part.replace("GMT", "");
    const minutes = (offset.startsWith("-") ? -1 : 1) * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(4, 6)));
    return { value: name, label: `UTC${offset} · ${name.replace(/_/g, " ")}`, minutes };
  });
  if (!withOffset.some((z) => z.value === "UTC")) withOffset.push({ value: "UTC", label: "UTC+00:00 · UTC", minutes: 0 });
  return withOffset.sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value)).map(({ value, label }) => ({ value, label }));
}
