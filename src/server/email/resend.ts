import "server-only";

import { serverEnv } from "@/server/env";

/**
 * Sends one email through Resend (https://resend.com/docs/api-reference/emails/send-email)
 * from the platform's own address. The domain (smartmanager.me) is verified in
 * Resend. The idempotency key makes a retried send deliver at most once.
 * Never logs addresses or contents — only Resend's status.
 */
export const PLATFORM_SENDER = "SmartManager <support@smartmanager.me>";
export const PLATFORM_REPLY_TO = "support@smartmanager.me";

export type SendResult = { ok: true; id: string } | { ok: false; retry: boolean; error: string };

export function emailConfigured(): boolean {
  return !!serverEnv().RESEND_API_KEY;
}

export async function sendPlatformEmail(email: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
}): Promise<SendResult> {
  const key = serverEnv().RESEND_API_KEY;
  if (!key) return { ok: false, retry: true, error: "not configured" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify({
        from: PLATFORM_SENDER,
        to: [email.to],
        reply_to: PLATFORM_REPLY_TO,
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, id: body.id ?? "" };
    }
    // 429 and 5xx are worth retrying; other 4xx (bad address, unverified domain…) are not.
    const retry = response.status === 429 || response.status >= 500;
    const body = (await response.json().catch(() => ({}))) as { name?: string };
    return { ok: false, retry, error: `resend ${response.status}${body.name ? ` ${body.name}` : ""}` };
  } catch (err) {
    return { ok: false, retry: true, error: err instanceof Error ? err.name : "network error" };
  }
}
