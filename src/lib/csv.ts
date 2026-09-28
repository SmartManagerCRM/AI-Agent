export type CsvColumn<T> = { label: string; value: (row: T) => string | number | null | undefined };

/** RFC 4180-ish CSV: quotes a field only when it needs it, doubles embedded quotes. */
function csvField(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => csvField(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvField(c.value(row))).join(","));
  return [header, ...lines].join("\r\n") + "\r\n";
}
