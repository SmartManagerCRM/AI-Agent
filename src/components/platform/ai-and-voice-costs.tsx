import { useTranslations } from "next-intl";

import type { DisplayMoney } from "@/server/platform/display-currency";
import type { VoiceAccount } from "@/server/platform/voice-account";

type Usage = {
  isPaid: boolean;
  isTrial: boolean;
  aiCostUsed: number;
  aiCostLimit: number | null;
  agentAiCost: number;
  agentAiResponses: number;
  agentVoiceCost: number;
  agentVoiceClips: number;
  agentVoiceCharacters: number;
};

/**
 * One subscriber's spend this period, kept apart: the AI Agent (the only thing
 * the plan's AI cost cap covers) and the premium voice (ElevenLabs — reported
 * on its own, never part of the cap).
 */
export function AiAndVoiceCosts({ usage, account, locale, usd }: { usage: Usage; account: VoiceAccount; locale: string; usd: DisplayMoney["usd"] }) {
  const t = useTranslations("platform.costs");
  const metered = usage.isPaid || usage.isTrial;
  const aiUsed = metered ? usage.aiCostUsed : usage.agentAiCost;
  const percent = usage.aiCostLimit ? Math.min(100, Math.round((aiUsed / usage.aiCostLimit) * 100)) : null;
  const q = account.quota;
  const resets = q?.resetsAt ? new Date(q.resetsAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="ai-voice-costs">
      <div className="rounded-lg border border-slate-200 p-3" data-testid="ai-agent-cost">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("aiTitle")}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">
          {usd(aiUsed, 4)}
          {usage.aiCostLimit !== null && <span className="text-sm font-normal text-slate-500">{t("cap", { amount: usd(usage.aiCostLimit) })}</span>}
        </p>
        {percent !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={`h-full ${percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {t("aiNote", { count: usage.agentAiResponses.toLocaleString(locale), period: usage.isTrial ? t("periodTrial") : t("periodBilling") })}
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 p-3" data-testid="premium-voice-cost">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{t("voiceTitle")}</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">
          {account.free ? t("free") : usd(usage.agentVoiceCost, 4)}
          {account.free && (
            <span className="text-sm font-normal text-slate-500">{t("atPaid", { amount: usd(usage.agentVoiceCost, 4) })}</span>
          )}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {t("voiceNote", { clips: usage.agentVoiceClips.toLocaleString(locale), chars: usage.agentVoiceCharacters.toLocaleString(locale) })}
        </p>
        <p className={`mt-2 text-xs font-medium ${account.exhausted ? "text-red-600" : "text-slate-600"}`} data-testid="voice-account">
          {account.exhausted
            ? t(account.free ? "usedUpFree" : "usedUpPlan", { until: resets ? t("until", { date: resets }) : "" })
            : q
              ? t("quota", {
                  tier: q.tier === "free" ? t("freeTier") : t("plan", { tier: q.tier ?? "" }),
                  used: q.used.toLocaleString(locale),
                  limit: q.limit.toLocaleString(locale),
                  resets: resets ? t("resets", { date: resets }) : "",
                })
              : t("unreadable")}
        </p>
      </div>
    </div>
  );
}
