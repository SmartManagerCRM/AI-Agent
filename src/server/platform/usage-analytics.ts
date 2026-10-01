/**
 * Super Admin usage analytics — pure (no I/O, unit-tested). Input rows come
 * from `platform_usage_overview` (Super Admin only); nothing here is ever
 * sent to a subscriber.
 */
export type UsageState =
  | "ACTIVE"
  | "CONVERSATION_WARNING"
  | "CONVERSATION_LIMIT_REACHED"
  | "CONVERSATION_GRACE_PERIOD"
  | "AI_COST_WARNING"
  | "AI_COST_LIMIT_REACHED"
  | "BOTH_LIMITS_REACHED"
  | "TRIAL"
  | "TRIAL_ENDED"
  | "NOT_ACTIVE";

export type SubscriberUsageRow = {
  tenantId: string;
  slug: string;
  businessName: string;
  tenantStatus: string;
  planKey: string;
  status: string;
  isPaid: boolean;
  isTrial: boolean;
  trialEnded: boolean;
  /** Super Admin only: "expired" | "conversation_limit" | "ai_cost_limit". */
  trialEndReason: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  conversationLimit: number | null;
  conversationLimitDefault: number | null;
  conversationLimitOverride: number | null;
  conversationsUsed: number;
  conversationPercent: number | null;
  conversationState: "ok" | "grace" | "blocked";
  graceUntil: string | null;
  aiCostLimit: number | null;
  aiCostLimitDefault: number | null;
  aiCostLimitOverride: number | null;
  /** Spend counted against the cap this period (paid plans; settled LLM calls). */
  aiCostUsed: number;
  aiCostReserved: number;
  aiCostPercent: number | null;
  aiState: "ok" | "warning" | "blocked";
  /** All Agent AI spend this period from the interaction ledger (trials included), Business Brain excluded. */
  agentAiCost: number;
  agentAiResponses: number;
  brainAiCost: number;
  brainAiCostTotal: number;
  usageState: UsageState;
};

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parseUsageRows(raw: unknown): SubscriberUsageRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): SubscriberUsageRow[] => {
    if (!item || typeof item !== "object") return [];
    const r = item as Record<string, unknown>;
    const tenantId = str(r.tenant_id);
    if (!tenantId) return [];
    const convState =
      r.conversation_state === "grace" || r.conversation_state === "blocked" ? r.conversation_state : "ok";
    const aiState = r.ai_state === "warning" || r.ai_state === "blocked" ? r.ai_state : "ok";
    return [
      {
        tenantId,
        slug: str(r.slug) ?? "",
        businessName: str(r.business_name) ?? str(r.slug) ?? "",
        tenantStatus: str(r.tenant_status) ?? "",
        planKey: str(r.plan_key) ?? "",
        status: str(r.status) ?? "",
        isPaid: r.is_paid === true,
        isTrial: r.is_trial === true,
        trialEnded: r.trial_ended === true,
        trialEndReason: str(r.trial_end_reason),
        periodStart: str(r.period_start),
        periodEnd: str(r.period_end),
        conversationLimit: num(r.conversation_limit),
        conversationLimitDefault: num(r.conversation_limit_default),
        conversationLimitOverride: num(r.conversation_limit_override),
        conversationsUsed: num(r.conversations_used) ?? 0,
        conversationPercent: num(r.conversation_percent),
        conversationState: convState,
        graceUntil: str(r.grace_until),
        aiCostLimit: num(r.ai_cost_limit),
        aiCostLimitDefault: num(r.ai_cost_limit_default),
        aiCostLimitOverride: num(r.ai_cost_limit_override),
        aiCostUsed: num(r.ai_cost_used) ?? 0,
        aiCostReserved: num(r.ai_cost_reserved) ?? 0,
        aiCostPercent: num(r.ai_cost_percent),
        aiState,
        agentAiCost: num(r.agent_ai_cost) ?? 0,
        agentAiResponses: num(r.agent_ai_responses) ?? 0,
        brainAiCost: num(r.brain_ai_cost) ?? 0,
        brainAiCostTotal: num(r.brain_ai_cost_total) ?? 0,
        usageState: (str(r.usage_state) as UsageState | null) ?? "NOT_ACTIVE",
      },
    ];
  });
}

export type PlanUsage = {
  planKey: string;
  subscribers: number;
  paidSubscribers: number;
  agentAiCost: number;
  conversations: number;
  /** Mean of each paid subscriber's conversation-limit utilization (%), null when none. */
  avgConversationUtilization: number | null;
  /** Mean of each paid subscriber's AI-cost-cap utilization (%), null when none. */
  avgAiCostUtilization: number | null;
};

export type PlatformUsageSummary = {
  totalAgentAiCost: number;
  totalBrainAiCost: number;
  totalConversations: number;
  totalAiResponses: number;
  avgCostPerConversation: number | null;
  avgCostPerAiResponse: number | null;
  byPlan: PlanUsage[];
  approachingConversationLimit: number;
  approachingAiCostLimit: number;
  inGracePeriod: number;
  conversationLimited: number;
  aiCostLimited: number;
  bothLimited: number;
  trialsEndedByLimit: number;
};

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

export function summarizePlatformUsage(rows: SubscriberUsageRow[]): PlatformUsageSummary {
  const totalAgentAiCost = rows.reduce((s, r) => s + r.agentAiCost, 0);
  const totalConversations = rows.reduce((s, r) => s + r.conversationsUsed, 0);
  const totalAiResponses = rows.reduce((s, r) => s + r.agentAiResponses, 0);

  const plans = new Map<string, SubscriberUsageRow[]>();
  for (const r of rows) plans.set(r.planKey, [...(plans.get(r.planKey) ?? []), r]);
  const byPlan = [...plans.entries()]
    .map(([planKey, list]): PlanUsage => {
      const paid = list.filter((r) => r.isPaid);
      return {
        planKey,
        subscribers: list.length,
        paidSubscribers: paid.length,
        agentAiCost: list.reduce((s, r) => s + r.agentAiCost, 0),
        conversations: list.reduce((s, r) => s + r.conversationsUsed, 0),
        avgConversationUtilization: mean(
          paid.flatMap((r) => (r.conversationPercent !== null ? [r.conversationPercent] : [])),
        ),
        avgAiCostUtilization: mean(paid.flatMap((r) => (r.aiCostPercent !== null ? [r.aiCostPercent] : []))),
      };
    })
    .sort((a, b) => a.planKey.localeCompare(b.planKey));

  const paid = rows.filter((r) => r.isPaid);
  return {
    totalAgentAiCost,
    totalBrainAiCost: rows.reduce((s, r) => s + r.brainAiCost, 0),
    totalConversations,
    totalAiResponses,
    avgCostPerConversation: totalConversations > 0 ? totalAgentAiCost / totalConversations : null,
    avgCostPerAiResponse: totalAiResponses > 0 ? totalAgentAiCost / totalAiResponses : null,
    byPlan,
    approachingConversationLimit: paid.filter((r) => r.usageState === "CONVERSATION_WARNING").length,
    approachingAiCostLimit: paid.filter((r) => r.aiState === "warning").length,
    inGracePeriod: paid.filter((r) => r.conversationState === "grace").length,
    conversationLimited: paid.filter((r) => r.conversationState === "blocked").length,
    aiCostLimited: paid.filter((r) => r.aiState === "blocked").length,
    bothLimited: paid.filter((r) => r.usageState === "BOTH_LIMITS_REACHED").length,
    trialsEndedByLimit: rows.filter(
      (r) => r.isTrial && (r.trialEndReason === "conversation_limit" || r.trialEndReason === "ai_cost_limit"),
    ).length,
  };
}

export const USAGE_STATE_STYLE: Record<UsageState, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CONVERSATION_WARNING: "bg-amber-50 text-amber-700",
  CONVERSATION_GRACE_PERIOD: "bg-orange-50 text-orange-700",
  CONVERSATION_LIMIT_REACHED: "bg-red-50 text-red-700",
  AI_COST_WARNING: "bg-amber-50 text-amber-700",
  AI_COST_LIMIT_REACHED: "bg-red-50 text-red-700",
  BOTH_LIMITS_REACHED: "bg-red-100 text-red-800",
  TRIAL: "bg-blue-50 text-blue-700",
  TRIAL_ENDED: "bg-red-50 text-red-700",
  NOT_ACTIVE: "bg-slate-100 text-slate-500",
};
