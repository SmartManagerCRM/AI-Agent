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
  /** Share (whole percent, ≤ 100) of the plan's monthly AI responses used — null when the plan has no such allowance. Never a count. */
  aiResponsePercent: number | null;
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
    aiResponsePercent: (() => {
      const p = num(r.ai_response_percent);
      return p === null ? null : Math.min(100, Math.max(0, Math.round(p)));
    })(),
  };
}

/** The notices' wording in English (messages: console.usage.* — the console passes its own `t` for the user's language). */
const USAGE_TEXT_EN = {
  aiLimited:
    "AI service is temporarily limited for this billing period. Upgrade your plan or wait until your next billing period.",
  conversationLimit:
    "You've reached your monthly customer conversation limit. Upgrade your plan to continue AI service, or wait until your next billing period.",
  trialEnded: "Your free trial has ended. Subscribe to a plan to bring your Agent back online.",
  whyConversations: "You've used all {limit} trial conversations.",
  whyConversationsNoLimit: "You've used all your trial conversations.",
  whyUsage: "You've used the trial's AI usage allowance.",
  whyExpired: "The trial period is over.",
  trialEndedTitle: "Free trial ended",
  trialWarningTitle: "You've used {level}% of your trial conversations",
  trialEndsOn: "The trial ends on {date}",
  trialEnds: "The trial ends",
  trialWarningBody:
    "{ends} or after {limit} customer conversations, whichever comes first. Subscribe to a plan to keep your Agent running.",
  resets: "Your usage resets on {date}.",
  limitTitle: "Conversation limit reached",
  graceUntil: " AI replies continue until {date} (grace period).",
  warningTitle: "You've used {level}% of your monthly conversations",
  warningBody: "Upgrade your plan before you reach the limit to keep AI replies running.",
  aiLimitedTitle: "AI service limited",
} as const;
type UsageKey = keyof typeof USAGE_TEXT_EN;
export type UsageT = (key: UsageKey, values?: Record<string, string | number>) => string;
const english: UsageT = (key, values = {}) =>
  USAGE_TEXT_EN[key].replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));

export const AI_LIMITED_MESSAGE = USAGE_TEXT_EN.aiLimited;
export const CONVERSATION_LIMIT_MESSAGE = USAGE_TEXT_EN.conversationLimit;
export const TRIAL_ENDED_MESSAGE = USAGE_TEXT_EN.trialEnded;

export type UsageNotice = { tone: "info" | "warning" | "danger"; title: string; body: string };

/** The free trial's notices: its conversation warnings, and why it ended. Never AI cost details. */
function trialNotices(
  usage: SubscriberUsage,
  formatDate: (iso: string) => string,
  t: UsageT,
  formatNumber: (n: number) => string,
): UsageNotice[] {
  if (usage.trialEnded) {
    const why =
      usage.trialEndReason === "conversation_limit"
        ? usage.conversationLimit !== null
          ? t("whyConversations", { limit: formatNumber(usage.conversationLimit) })
          : t("whyConversationsNoLimit")
        : usage.trialEndReason === "usage_limit"
          ? t("whyUsage")
          : t("whyExpired");
    return [{ tone: "danger", title: t("trialEndedTitle"), body: `${why} ${t("trialEnded")}` }];
  }
  if (usage.warningLevel > 0 && usage.conversationLimit !== null) {
    const ends = usage.trialEndsAt ? t("trialEndsOn", { date: formatDate(usage.trialEndsAt) }) : t("trialEnds");
    return [
      {
        tone: usage.warningLevel >= 95 ? "danger" : "warning",
        title: t("trialWarningTitle", { level: usage.warningLevel }),
        body: t("trialWarningBody", { ends, limit: formatNumber(usage.conversationLimit) }),
      },
    ];
  }
  return [];
}

/** The subscriber console's usage notices (warnings at the configured levels, the grace period, the limit). */
export function usageNotices(
  usage: SubscriberUsage,
  formatDate: (iso: string) => string,
  t: UsageT = english,
  formatNumber: (n: number) => string = (n) => n.toLocaleString("en"),
): UsageNotice[] {
  if (usage.isTrial) return trialNotices(usage, formatDate, t, formatNumber);
  const notices: UsageNotice[] = [];
  const resets = usage.periodEnd ? t("resets", { date: formatDate(usage.periodEnd) }) : "";
  if (usage.conversationState === "blocked") {
    notices.push({
      tone: "danger",
      title: t("limitTitle"),
      body: `${t("conversationLimit")} ${resets}`.trim(),
    });
  } else if (usage.conversationState === "grace") {
    const until = usage.graceUntil ? t("graceUntil", { date: formatDate(usage.graceUntil) }) : "";
    notices.push({
      tone: "danger",
      title: t("limitTitle"),
      body: `${t("conversationLimit")}${until} ${resets}`.trim(),
    });
  } else if (usage.warningLevel > 0) {
    notices.push({
      tone: usage.warningLevel >= 95 ? "danger" : "warning",
      title: t("warningTitle", { level: usage.warningLevel }),
      body: `${t("warningBody")} ${resets}`.trim(),
    });
  }
  if (usage.aiLimited) {
    notices.push({ tone: "danger", title: t("aiLimitedTitle"), body: `${t("aiLimited")} ${resets}`.trim() });
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
