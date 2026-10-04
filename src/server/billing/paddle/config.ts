/**
 * Paddle Billing settings, read from the environment (src/server/env-core.ts).
 * Sandbox or live comes from the keys themselves — Paddle prefixes them
 * (`pdl_sdbx_…` / `pdl_live_…` API keys, `test_…` / `live_…` client-side
 * tokens) — so a sandbox key can never be used against the live API by
 * mistake. Pure (no I/O): unit-tested in tests/unit/paddle.test.ts.
 */
export type PaddleEnvironmentName = "sandbox" | "production";

export type PaddleConfig = {
  apiKey: string;
  clientToken: string;
  webhookSecret: string;
  environment: PaddleEnvironmentName;
};

export type PaddleConfigResult =
  | { ok: true; config: PaddleConfig }
  | { ok: false; reason: "missing" | "mismatch" | "unknown_environment" };

function fromApiKey(key: string): PaddleEnvironmentName | null {
  if (key.startsWith("pdl_sdbx_")) return "sandbox";
  if (key.startsWith("pdl_live_")) return "production";
  return null;
}

function fromClientToken(token: string): PaddleEnvironmentName | null {
  if (token.startsWith("test_")) return "sandbox";
  if (token.startsWith("live_")) return "production";
  return null;
}

export function readPaddleConfig(env: {
  PADDLE_API_KEY?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_WEBHOOK_SECRET?: string;
}): PaddleConfigResult {
  const apiKey = env.PADDLE_API_KEY?.trim();
  const clientToken = env.PADDLE_CLIENT_TOKEN?.trim();
  const webhookSecret = env.PADDLE_WEBHOOK_SECRET?.trim();
  if (!apiKey || !clientToken || !webhookSecret) return { ok: false, reason: "missing" };
  const byKey = fromApiKey(apiKey);
  const byToken = fromClientToken(clientToken);
  if (byKey && byToken && byKey !== byToken) return { ok: false, reason: "mismatch" };
  const environment = byKey ?? byToken;
  if (!environment) return { ok: false, reason: "unknown_environment" };
  return { ok: true, config: { apiKey, clientToken, webhookSecret, environment } };
}
