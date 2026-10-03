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

const usd = (v: number, digits = 2) => `$${v.toFixed(digits)}`;

/**
 * One subscriber's spend this period, kept apart: the AI Agent (the only thing
 * the plan's AI cost cap covers) and the premium voice (ElevenLabs — reported
 * on its own, never part of the cap).
 */
export function AiAndVoiceCosts({ usage, account, locale }: { usage: Usage; account: VoiceAccount; locale: string }) {
  const metered = usage.isPaid || usage.isTrial;
  const aiUsed = metered ? usage.aiCostUsed : usage.agentAiCost;
  const percent = usage.aiCostLimit ? Math.min(100, Math.round((aiUsed / usage.aiCostLimit) * 100)) : null;
  const q = account.quota;
  const resets = q?.resetsAt ? new Date(q.resetsAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2" data-testid="ai-voice-costs">
      <div className="rounded-lg border border-slate-200 p-3" data-testid="ai-agent-cost">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">AI Agent cost</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">
          {usd(aiUsed, 4)}
          {usage.aiCostLimit !== null && <span className="text-sm font-normal text-slate-500"> / {usd(usage.aiCostLimit)} cap</span>}
        </p>
        {percent !== null && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className={`h-full ${percent >= 100 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-slate-500">
          {usage.agentAiResponses.toLocaleString(locale)} AI replies this {usage.isTrial ? "trial" : "period"}. This is the only cost the
          plan&apos;s AI cost cap covers.
        </p>
      </div>
      <div className="rounded-lg border border-slate-200 p-3" data-testid="premium-voice-cost">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Premium voice (ElevenLabs)</p>
        <p className="mt-1 text-2xl font-semibold text-slate-900">
          {account.free ? "Free" : usd(usage.agentVoiceCost, 4)}
          {account.free && (
            <span className="text-sm font-normal text-slate-500"> · ≈ {usd(usage.agentVoiceCost, 4)} at paid rates</span>
          )}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          {usage.agentVoiceClips.toLocaleString(locale)} clips · {usage.agentVoiceCharacters.toLocaleString(locale)} characters generated this period
          (replays from the cache cost nothing). Not part of the AI cost cap.
        </p>
        <p className={`mt-2 text-xs font-medium ${account.exhausted ? "text-red-600" : "text-slate-600"}`} data-testid="voice-account">
          {account.exhausted
            ? `${account.free ? "Free-tier" : "Plan"} characters used up — every Agent speaks with the customer's device voice${resets ? ` until ${resets}` : ""}.`
            : q
              ? `ElevenLabs ${q.tier === "free" ? "free tier" : `${q.tier ?? ""} plan`}: ${q.used.toLocaleString(locale)} / ${q.limit.toLocaleString(locale)} characters used this month${resets ? ` · resets ${resets}` : ""}. When they run out, Agents switch to the device voice automatically.`
              : "ElevenLabs allowance not readable (the API key needs the “User → Read” permission). Agents still switch to the device voice if ElevenLabs refuses for quota."}
        </p>
      </div>
    </div>
  );
}
