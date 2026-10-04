import "server-only";

import { Webhooks } from "@paddle/paddle-node-sdk";

import type { Json } from "@/types/database";
import { serviceClient } from "@/server/supabase/clients";

import { paddleConfig } from "./client";
import { paddleAction } from "./events";
import { verifyPaddleSignature } from "./signature";

export type PaddleWebhookResult = { status: number; body: Record<string, string> };

/**
 * Paddle's notifications (POST /api/payments/webhook/paddle). The only way a
 * subscription payment, renewal, plan change or cancellation is recorded:
 * the signature is checked with the destination's secret first, and an
 * unsigned or tampered request changes nothing. Each Paddle event id is
 * applied once (the database records it), so Paddle's retries are harmless.
 *
 * Status codes tell Paddle whether to retry: 200 for anything handled or
 * deliberately ignored, 400 for a bad signature, 500 only when the database
 * couldn't record it (worth retrying). Error details are never returned —
 * this endpoint is public.
 */
export async function handlePaddleWebhook(rawBody: string, signature: string | null): Promise<PaddleWebhookResult> {
  const config = paddleConfig();
  if (!config) return { status: 503, body: { error: "not configured" } };
  if (!verifyPaddleSignature(rawBody, signature, config.webhookSecret)) {
    return { status: 400, body: { error: "invalid signature" } };
  }

  let raw: Record<string, unknown>;
  let action: ReturnType<typeof paddleAction>;
  try {
    raw = JSON.parse(rawBody) as Record<string, unknown>;
    action = paddleAction(Webhooks.fromJson(raw as never));
  } catch {
    return { status: 400, body: { error: "unreadable event" } };
  }
  if (action.kind === "ignore") return { status: 200, body: { received: "ignored" } };

  const supabase = serviceClient();
  if (action.kind === "payment") {
    const { data, error } = await supabase.rpc("record_paddle_payment", {
      p_event_id: action.eventId,
      p_transaction_id: action.transactionId,
      p_paddle_subscription_id: action.subscriptionId,
      p_paddle_customer_id: action.customerId,
      p_plan_key: action.planKey,
      p_amount_minor: action.amountMinor,
      p_currency: action.currency,
      p_check_amount: action.checkAmount,
      p_period_start: action.periodStart,
      p_period_end: action.periodEnd,
      p_raw: raw as Json,
    });
    if (error) return { status: 500, body: { error: "could not record" } };
    return { status: 200, body: { received: data ?? "recorded" } };
  }

  const { data, error } = await supabase.rpc("apply_paddle_subscription_event", {
    p_event_id: action.eventId,
    p_occurred_at: action.occurredAt,
    p_paddle_subscription_id: action.subscriptionId,
    p_transaction_id: action.transactionId,
    p_paddle_customer_id: action.customerId,
    p_status: action.status,
    p_cancel_at: action.cancelAt,
    p_plan_key: action.planKey,
    p_raw: raw as Json,
  });
  if (error) return { status: 500, body: { error: "could not record" } };
  return { status: 200, body: { received: data ?? "applied" } };
}
