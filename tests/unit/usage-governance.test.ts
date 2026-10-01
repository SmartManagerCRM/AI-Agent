import { describe, expect, it } from "vitest";

import { geminiMaxOutputTokens } from "@/server/ai/gemini";
import {
  AI_LIMITED_MESSAGE,
  CONVERSATION_LIMIT_MESSAGE,
  estimateCallCostUsd,
  parseSubscriberUsage,
  usageNotices,
  type SubscriberUsage,
} from "@/server/billing/usage";
import { parseUsageRows, summarizePlatformUsage } from "@/server/platform/usage-analytics";

const base: SubscriberUsage = {
  isPaid: true,
  status: "active",
  planKey: "starter",
  periodStart: "2026-10-17T00:00:00.000Z",
  periodEnd: "2026-11-17T00:00:00.000Z",
  conversationLimit: 1000,
  conversationsUsed: 0,
  conversationPercent: 0,
  warningLevel: 0,
  gracePeriodHours: 24,
  limitReachedAt: null,
  graceUntil: null,
  conversationState: "ok",
  aiLimited: false,
};
const date = (iso: string) => iso.slice(0, 10);

describe("subscriber usage summary", () => {
  it("parses the summary and never carries AI cost fields, even if present in the payload", () => {
    const parsed = parseSubscriberUsage({
      is_paid: true,
      status: "active",
      plan_key: "starter",
      period_start: "2026-10-17T00:00:00Z",
      period_end: "2026-11-17T00:00:00Z",
      conversation_limit: 1000,
      conversations_used: 999,
      conversation_percent: 99.9,
      conversation_warning_level: 95,
      grace_period_hours: 24,
      conversation_state: "ok",
      ai_limited: false,
      ai_cost_limit: 15,
      ai_cost_used: 14.99,
    });
    expect(parsed?.conversationsUsed).toBe(999);
    expect(parsed?.warningLevel).toBe(95);
    expect(JSON.stringify(parsed)).not.toMatch(/cost|usd|budget|15|14\.99/i);
  });

  it("rejects malformed payloads", () => {
    expect(parseSubscriberUsage(null)).toBeNull();
    expect(parseSubscriberUsage([])).toBeNull();
  });
});

describe("subscriber notices", () => {
  it.each([70, 85, 95])("warns at %i%%", (level) => {
    const notices = usageNotices({ ...base, warningLevel: level }, date);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain(`${level}%`);
  });

  it("no notice below the first warning level", () => {
    expect(usageNotices({ ...base, conversationsUsed: 500, warningLevel: 0 }, date)).toEqual([]);
  });

  it("grace period: the limit message, the grace deadline and the reset date", () => {
    const [notice] = usageNotices(
      {
        ...base,
        conversationsUsed: 1000,
        warningLevel: 100,
        conversationState: "grace",
        graceUntil: "2026-11-02T10:00:00Z",
      },
      date,
    );
    expect(notice.body).toContain(CONVERSATION_LIMIT_MESSAGE);
    expect(notice.body).toContain("2026-11-02");
    expect(notice.body).toContain("Your usage resets on 2026-11-17.");
  });

  it("AI limited: customer-safe wording, no figures", () => {
    const notices = usageNotices({ ...base, aiLimited: true }, date);
    expect(notices.map((n) => n.body).join(" ")).toContain(AI_LIMITED_MESSAGE);
    expect(JSON.stringify(notices)).not.toMatch(/\$|cost|budget/i);
  });
});

describe("worst-case cost reservation", () => {
  const pricing = { inputPricePerMillionUsd: 0.1, outputPricePerMillionUsd: 0.4 };

  it("prompt ≈ chars / 3 tokens plus the full output ceiling", () => {
    // (1000 × $0.1 + 2048 × $0.4) / 1M = $0.0009192 → rounded up to six decimals.
    expect(estimateCallCostUsd(pricing, 3000, 2048)).toBe(0.00092);
  });

  it("is never below the cost of a call that uses everything it was allowed", () => {
    const actualMax = (1000 * 0.1 + 2048 * 0.4) / 1e6;
    expect(estimateCallCostUsd(pricing, 3000, 2048)).toBeGreaterThanOrEqual(actualMax);
  });

  it("thinking models reserve their real (raised) output ceiling", () => {
    expect(geminiMaxOutputTokens("gemini-3.5-flash-lite", 512)).toBe(2048);
    expect(geminiMaxOutputTokens("gemini-2.0-flash", 512)).toBe(512);
  });
});

describe("platform usage analytics", () => {
  const rows = parseUsageRows([
    {
      tenant_id: "a",
      slug: "a",
      business_name: "A",
      plan_key: "starter",
      status: "active",
      is_paid: true,
      conversations_used: 750,
      conversation_percent: 75,
      conversation_state: "ok",
      ai_cost_used: 3,
      ai_cost_percent: 20,
      ai_state: "ok",
      agent_ai_cost: 3,
      agent_ai_responses: 600,
      brain_ai_cost: 0.5,
      usage_state: "CONVERSATION_WARNING",
    },
    {
      tenant_id: "b",
      slug: "b",
      business_name: "B",
      plan_key: "starter",
      status: "active",
      is_paid: true,
      conversations_used: 1000,
      conversation_percent: 100,
      conversation_state: "blocked",
      ai_cost_used: 15,
      ai_cost_percent: 100,
      ai_state: "blocked",
      agent_ai_cost: 15,
      agent_ai_responses: 1400,
      brain_ai_cost: 0.2,
      usage_state: "BOTH_LIMITS_REACHED",
    },
    {
      tenant_id: "c",
      slug: "c",
      business_name: "C",
      plan_key: "growth",
      status: "trialing",
      is_paid: false,
      conversations_used: 250,
      conversation_state: "ok",
      ai_state: "ok",
      agent_ai_cost: 2,
      agent_ai_responses: 0,
      brain_ai_cost: 0,
      usage_state: "TRIAL",
    },
  ]);
  const s = summarizePlatformUsage(rows);

  it("totals and averages come from the real rows", () => {
    expect(s.totalAgentAiCost).toBe(20);
    expect(s.totalBrainAiCost).toBeCloseTo(0.7, 6);
    expect(s.avgCostPerConversation).toBeCloseTo(20 / 2000, 9);
    expect(s.avgCostPerAiResponse).toBeCloseTo(20 / 2000, 9);
  });

  it("utilization by plan counts paid subscribers only", () => {
    const starter = s.byPlan.find((p) => p.planKey === "starter");
    expect(starter?.avgConversationUtilization).toBe(87.5);
    expect(starter?.avgAiCostUtilization).toBe(60);
    expect(s.byPlan.find((p) => p.planKey === "growth")?.avgConversationUtilization).toBeNull();
  });

  it("counts limited subscribers (trials never)", () => {
    expect(s.approachingConversationLimit).toBe(1);
    expect(s.conversationLimited).toBe(1);
    expect(s.aiCostLimited).toBe(1);
    expect(s.bothLimited).toBe(1);
  });

  it("no data → no invented averages", () => {
    const empty = summarizePlatformUsage([]);
    expect(empty.avgCostPerConversation).toBeNull();
    expect(empty.avgCostPerAiResponse).toBeNull();
  });
});
