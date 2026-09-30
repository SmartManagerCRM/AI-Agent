/**
 * `[AGENT]` diagnostics: one compact JSON line per step of a customer
 * message (tenant resolution, knowledge loaded, intent, tool calls, model,
 * duration, error category). Safe by construction — callers pass only ids,
 * counts, rule/tool names, provider/model names and error *categories*:
 * never message text, customer details, API keys, tokens or raw provider
 * error bodies.
 */
export type AgentLogFields = Record<string, string | number | boolean | null | undefined>;

export function agentLog(event: string, fields: AgentLogFields = {}): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(`[AGENT] ${JSON.stringify({ event, ...fields })}`);
}

/** "AI_PROVIDER_ERROR: Gemini responded 404: {...}" → "AI_PROVIDER_ERROR:404" — the category, never the body. */
export function errorCategory(error: string): string {
  const code = /^([A-Z_]+):/.exec(error)?.[1] ?? "UNKNOWN_ERROR";
  const status = /responded (\d{3})/.exec(error)?.[1];
  return status ? `${code}:${status}` : code;
}
