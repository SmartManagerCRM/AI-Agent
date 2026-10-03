/**
 * Status / fulfilment / channel values as the user's language shows them
 * (messages: common.statusLabel, common.fulfillment, common.channel). An
 * unknown value falls back to the raw value, made readable.
 */
type T = { (key: string): string; has(key: string): boolean };

const readable = (value: string) => value.replace(/_/g, " ");

export function statusLabel(t: T, status: string | null | undefined): string {
  if (!status) return "—";
  const key = `common.statusLabel.${status}`;
  return t.has(key) ? t(key) : readable(status);
}

export function fulfillmentLabel(t: T, type: string | null | undefined): string {
  if (!type) return "—";
  const key = `common.fulfillment.${type}`;
  return t.has(key) ? t(key) : readable(type);
}

export function channelLabel(t: T, channel: string | null | undefined): string {
  if (!channel) return "—";
  const key = `common.channel.${channel}`;
  return t.has(key) ? t(key) : readable(channel);
}

/** An audit-log action ("order.created") in the user's language (common.auditAction.order__created); unknown ones made readable. */
export function auditActionLabel(t: T, action: string): string {
  const key = `common.auditAction.${action.replace(/\./g, "__")}`;
  if (t.has(key)) return t(key);
  const readable = action.replace(/[._]/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

/**
 * A Business Brain job's status reason (written in English by the pipeline,
 * src/server/brain) in the reader's language. Unknown reasons — a raw
 * technical error — come back as `fallback` (null hides them).
 */
export function jobReasonLabel(t: T, reason: string, fallback: string | null = null): string | null {
  if (reason === "Cancelled by the owner.") return t("common.jobReason.cancelled");
  if (reason.startsWith("Interrupted — the server restarted")) return t("common.jobReason.interrupted");
  if (reason === "No source could be read.") return t("common.jobReason.noSource");
  const budget = /^The analysis budget was reached; (\d+) page/.exec(reason);
  if (budget) return (t as unknown as (key: string, values: Record<string, number>) => string)("common.jobReason.budget", { n: Number(budget[1]) });
  return fallback;
}
