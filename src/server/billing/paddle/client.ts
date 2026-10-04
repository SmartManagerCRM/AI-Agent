import "server-only";

import { Environment, LogLevel, Paddle } from "@paddle/paddle-node-sdk";

import { serverEnv } from "@/server/env";

import { readPaddleConfig, type PaddleConfig, type PaddleConfigResult } from "./config";

/** Paddle Billing settings from the environment (all three keys, sandbox or live). */
export function paddleSettings(): PaddleConfigResult {
  const env = serverEnv();
  return readPaddleConfig({
    PADDLE_API_KEY: env.PADDLE_API_KEY,
    PADDLE_CLIENT_TOKEN: env.PADDLE_CLIENT_TOKEN,
    PADDLE_WEBHOOK_SECRET: env.PADDLE_WEBHOOK_SECRET,
  });
}

export function paddleConfig(): PaddleConfig | null {
  const result = paddleSettings();
  return result.ok ? result.config : null;
}

/** A Paddle API client (platform-level: the SaaS's own Paddle account — no tenant data is kept in it). */
export function paddleClient(config: PaddleConfig): Paddle {
  return new Paddle(config.apiKey, {
    environment: config.environment === "sandbox" ? Environment.sandbox : Environment.production,
    // Never let the SDK print requests (they carry customer details).
    logLevel: LogLevel.none,
  });
}
