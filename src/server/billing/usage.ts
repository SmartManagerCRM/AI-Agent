import type { ModelPricing } from "@/server/ai/pricing";

/**
 * Subscription usage — the pure, client-safe half (no I/O, unit-tested).
 *
 * `SubscriberUsage` is exactly what `tenant_usage_summary` returns to a
 * subscriber: conversation usage and whether AI is limited, never an AI
 * dollar figure, percentage or budget (those exist only in Super-Admin-only
 * tables and functions).
 */
export type ConversationState = "ok" | "grace" | "blocked";

/** Why a trial ended — an AI-allowance end is only ever reported as a generic "usage_limit". */
export type TrialEndReason = "expired" | "conversation_limit" | "usage_limit";

export type SubscriberUsage = {
  isPaid: boolean;
  isTrial: boolean;
  trialEnded: boolean;
  trialEndReason: TrialEndReason | null;
  trialEndsAt: string | null;
  status: string;
  planKey: string;
  periodStart: string | null;
  periodEnd: string | null;
  conversationLimit: number | null;
  conversationsUsed: number;
  conversationPercent: number | null;
  warningLevel: number;
  gracePeriodHours: number;
  limitReachedAt: string | null;
  graceUntil: string | null;
  conversationState: ConversationState;
  aiLimited: boolean;
};

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function parseSubscriberUsage(raw: unknown): SubscriberUsage | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const state = r.conversation_state;
  const reason = r.trial_end_reason;
  return {
    isPaid: r.is_paid === true,
    isTrial: r.is_trial === true,
    trialEnded: r.trial_ended === true,
    trialEndReason: reason === "expired" || reason === "conversation_limit" || reason === "usage_limit" ? reason : null,
    trialEndsAt: str(r.trial_ends_at),
    status: str(r.status) ?? "",
    planKey: str(r.plan_key) ?? "",
    periodStart: str(r.period_start),
    periodEnd: str(r.period_end),
    conversationLimit: num(r.conversation_limit),
    conversationsUsed: num(r.conversations_used) ?? 0,
    conversationPercent: num(r.conversation_percent),
    warningLevel: num(r.conversation_warning_level) ?? 0,
    gracePeriodHours: num(r.grace_period_hours) ?? 0,
    limitReachedAt: str(r.limit_reached_at),
    graceUntil: str(r.grace_until),
    conversationState: state === "grace" || state === "blocked" ? state : "ok",
    aiLimited: r.ai_limited === true,
  };
}

export const AI_LIMITED_MESSAGE =
  "AI service is temporarily limited for this billing period. Upgrade your plan or wait until your next billing period.";
export const CONVERSATION_LIMIT_MESSAGE =
  "You've reached your monthly customer conversation limit. Upgrade your plan to continue AI service, or wait until your next billing period.";

export const TRIAL_ENDED_MESSAGE = "Your free trial has ended. Subscribe to a plan to bring your Agent back online.";

export type UsageNotice = { tone: "info" | "warning" | "danger"; title: string; body: string };

/** The free trial's notices: its conversation warnings, and why it ended. Never AI cost details. */
function trialNotices(usage: SubscriberUsage, formatDate: (iso: string) => string): UsageNotice[] {
  if (usage.trialEnded) {
    const why =
      usage.trialEndReason === "conversation_limit"
        ? usage.conversationLimit !== null
          ? `You've used all ${usage.conversationLimit.toLocaleString("en")} trial conversations.`
          : "You've used all your trial conversations."
        : usage.trialEndReason === "usage_limit"
          ? "You've used the trial's AI usage allowance."
          : "The trial period is over.";
    return [{ tone: "danger", title: "Free trial ended", body: `${why} ${TRIAL_ENDED_MESSAGE}` }];
  }
  if (usage.warningLevel > 0 && usage.conversationLimit !== null) {
    const ends = usage.trialEndsAt ? ` The trial ends on ${formatDate(usage.trialEndsAt)}` : " The trial ends";
    return [
      {
        tone: usage.warningLevel >= 95 ? "danger" : "warning",
        title: `You've used ${usage.warningLevel}% of your trial conversations`,
        body: `${ends.trim()} or after ${usage.conversationLimit.toLocaleString("en")} customer conversations, whichever comes first. Subscribe to a plan to keep your Agent running.`,
      },
    ];
  }
  return [];
}

/** The subscriber console's usage notices (warnings at the configured levels, the grace period, the limit). */
export function usageNotices(usage: SubscriberUsage, formatDate: (iso: string) => string): UsageNotice[] {
  if (usage.isTrial) return trialNotices(usage, formatDate);
  const notices: UsageNotice[] = [];
  const resets = usage.periodEnd ? `Your usage resets on ${formatDate(usage.periodEnd)}.` : "";
  if (usage.conversationState === "blocked") {
    notices.push({
      tone: "danger",
      title: "Conversation limit reached",
      body: `${CONVERSATION_LIMIT_MESSAGE} ${resets}`.trim(),
    });
  } else if (usage.conversationState === "grace") {
    const until = usage.graceUntil ? ` AI replies continue until ${formatDate(usage.graceUntil)} (grace period).` : "";
    notices.push({
      tone: "danger",
      title: "Conversation limit reached",
      body: `${CONVERSATION_LIMIT_MESSAGE}${until} ${resets}`.trim(),
    });
  } else if (usage.warningLevel > 0) {
    notices.push({
      tone: usage.warningLevel >= 95 ? "danger" : "warning",
      title: `You've used ${usage.warningLevel}% of your monthly conversations`,
      body: `Upgrade your plan before you reach the limit to keep AI replies running. ${resets}`.trim(),
    });
  }
  if (usage.aiLimited) {
    notices.push({ tone: "danger", title: "AI service limited", body: `${AI_LIMITED_MESSAGE} ${resets}`.trim() });
  }
  return notices;
}

/**
 * Worst-case cost of ONE model call, reserved before the call: prompt
 * tokens estimated generously from its size (≈3 characters per token, which
 * over-counts for English and is close for Arabic) plus the full output-token
 * ceiling. The actual cost (from the provider's real token counts) replaces
 * it once the call returns.
 */
export function estimateCallCostUsd(pricing: ModelPricing, promptChars: number, maxOutputTokens: number): number {
  const inputTokens = Math.ceil(Math.max(promptChars, 0) / 3);
  const outputTokens = Math.max(maxOutputTokens, 0);
  const raw =
    (inputTokens / 1_000_000) * pricing.inputPricePerMillionUsd +
    (outputTokens / 1_000_000) * pricing.outputPricePerMillionUsd;
  // Rounded UP to the ledger's six decimals: a reservation must never be below the real worst case.
  return Math.ceil(Math.round(raw * 1e12) / 1e6) / 1e6;
}
