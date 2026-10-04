import "server-only";

import { after } from "next/server";

import { consoleOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env";
import { serviceClient } from "@/server/supabase/clients";

import { emailConfigured, sendPlatformEmail } from "./resend";
import { emailLanguage, localized, renderSubscriptionEmail, type EmailPlan, type SubscriptionEmailKind } from "./subscription-templates";

/**
 * Sends the subscription emails the database queued (subscription_emails):
 * right after whatever changed the subscription (a Paddle webhook, the Billing
 * page, a new business, the Super Admin), and every few minutes as a safety
 * net (src/instrumentation.ts). Each email is claimed by one sender only; a
 * send that failed for a temporary reason is retried a few times, waiting
 * longer each time. Never logs addresses or contents.
 */
const MAX_ATTEMPTS = 6;
const RETRY_BASE_SECONDS = 60;
// Not sent after this long (an email about something two days old would confuse more than it helps).
const STALE_MS = 48 * 60 * 60 * 1000;
const BATCH = 20;

export const retryDelaySeconds = (attempts: number) => RETRY_BASE_SECONDS * 2 ** Math.max(0, attempts - 1);

function billingUrl(lang: string, slug: string): string {
  const env = serverEnv();
  const origin = consoleOrigin({
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
    consoleUrl: env.CONSOLE_URL,
  });
  return `${origin}/${lang}/${slug}/billing`;
}

export async function processSubscriptionEmails(): Promise<{ claimed: number; sent: number }> {
  // Without an email service nothing is claimed: the emails wait (until they are too old to send).
  if (!emailConfigured()) return { claimed: 0, sent: 0 };
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("claim_subscription_emails", { p_limit: BATCH });
  if (error || !data) return { claimed: 0, sent: 0 };

  let sent = 0;
  for (const row of data) {
    const finish = (status: "sent" | "skipped" | "retry" | "failed", reason: string | null = null, retryIn: number | null = null) =>
      supabase.rpc("finish_subscription_email", { p_id: row.id, p_status: status, p_error: reason ?? undefined, p_retry_in_seconds: retryIn ?? undefined });

    if (!row.owner_email) {
      await finish("skipped", "no address");
      continue;
    }
    if (Date.now() - new Date(row.created_at).getTime() > STALE_MS) {
      await finish("skipped", "too old");
      continue;
    }
    try {
      const lang = emailLanguage(row.owner_language, row.default_language);
      const email = renderSubscriptionEmail({
        kind: row.kind as SubscriptionEmailKind,
        details: (row.details ?? {}) as Record<string, unknown>,
        lang,
        timezone: row.tenant_timezone,
        businessName: localized(row.business_name, lang) || row.tenant_slug,
        ownerName: row.owner_name,
        plans: (row.plans ?? {}) as Record<string, EmailPlan>,
        subscription: (row.subscription ?? null) as never,
        billingUrl: billingUrl(lang, row.tenant_slug),
      });
      const result = await sendPlatformEmail({ to: row.owner_email, ...email, idempotencyKey: `subscription-email-${row.id}` });
      if (result.ok) {
        sent++;
        await finish("sent");
      } else if (result.retry && row.attempts < MAX_ATTEMPTS) {
        await finish("retry", result.error, retryDelaySeconds(row.attempts));
      } else {
        console.error(`[email] subscription email ${row.id} (${row.kind}) not sent: ${result.error}`);
        await finish("failed", result.error);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.name : "error";
      await finish(row.attempts < MAX_ATTEMPTS ? "retry" : "failed", reason, row.attempts < MAX_ATTEMPTS ? retryDelaySeconds(row.attempts) : null);
    }
  }
  return { claimed: data.length, sent };
}

// One run at a time per server (runs on other servers are kept apart by the database's claims).
let running: Promise<void> | null = null;
let again = false;

/** Sends everything that is due, then stops. */
export function runSubscriptionEmails(): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    try {
      for (let round = 0; round < 20; round++) {
        const result = await processSubscriptionEmails();
        if (result.claimed < BATCH) break;
      }
    } catch {
      // The emails stay queued; the next run picks them up.
    } finally {
      running = null;
      if (again) {
        again = false;
        void runSubscriptionEmails();
      }
    }
  })();
  return running;
}

/** After a subscription change: send its email once the response is sent. */
export function sendSubscriptionEmailsSoon(): void {
  try {
    after(() => runSubscriptionEmails());
  } catch {
    void runSubscriptionEmails();
  }
}

const EVERY_MS = 2 * 60_000;
let started = false;

/** Safety net next to the after-change runs: retries, and changes made where no run was started. */
export function startSubscriptionEmailSweeps(): void {
  if (started || process.env.NEXT_PHASE === "phase-production-build" || !process.env.SUPABASE_SECRET_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  started = true;
  setTimeout(() => void runSubscriptionEmails(), 20_000).unref();
  setInterval(() => void runSubscriptionEmails(), EVERY_MS).unref();
}
