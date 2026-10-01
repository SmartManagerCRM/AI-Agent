"use client";

import { useActionState } from "react";

import {
  setPlanUsageLimitsAction,
  setSubscriberUsageOverridesAction,
  updateUsageSettingsAction,
} from "@/server/platform/usage-actions";

const input = "rounded-md border border-neutral-300 px-3 py-2";
const button =
  "rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50";

function Result({ message }: { message: string | undefined }) {
  if (!message) return null;
  const isError = message.startsWith("VALIDATION_ERROR");
  return <p className={`w-full text-sm ${isError ? "text-red-600" : "text-emerald-700"}`}>{message}</p>;
}

/** Plan defaults: conversation limit, AI cost cap and grace period (Super Admin only). Subscriber overrides are untouched. */
export function PlanUsageLimitsForm({
  locale,
  planKey,
  conversationLimit,
  aiCostLimitUsd,
  gracePeriodHours,
}: {
  locale: string;
  planKey: string;
  conversationLimit: number | null;
  aiCostLimitUsd: number | null;
  gracePeriodHours: number;
}) {
  const [message, formAction, pending] = useActionState(setPlanUsageLimitsAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="planKey" value={planKey} />
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Conversations / period
        <input
          name="conversationLimit"
          type="number"
          min="1"
          step="1"
          placeholder="No limit"
          defaultValue={conversationLimit ?? ""}
          className={`w-32 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        AI cost cap (USD) / period
        <input
          name="aiCostLimitUsd"
          type="number"
          min="0"
          step="0.01"
          placeholder="No cap"
          defaultValue={aiCostLimitUsd ?? ""}
          className={`w-32 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Grace period (hours)
        <input
          name="gracePeriodHours"
          type="number"
          min="0"
          max="720"
          step="1"
          required
          defaultValue={gracePeriodHours}
          className={`w-24 ${input}`}
        />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Saving…" : "Save limits"}
      </button>
      <Result message={message} />
    </form>
  );
}

/** Per-subscriber overrides. Empty = use the plan default; "Reset to Plan Defaults" clears both. */
export function SubscriberUsageOverridesForm({
  locale,
  tenantId,
  slug,
  conversationLimitOverride,
  aiCostLimitOverride,
  conversationLimitDefault,
  aiCostLimitDefault,
}: {
  locale: string;
  tenantId: string;
  slug: string;
  conversationLimitOverride: number | null;
  aiCostLimitOverride: number | null;
  conversationLimitDefault: number | null;
  aiCostLimitDefault: number | null;
}) {
  const [message, formAction, pending] = useActionState(setSubscriberUsageOverridesAction, undefined);
  const hasOverride = conversationLimitOverride !== null || aiCostLimitOverride !== null;
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Conversation limit override
        <input
          name="conversationLimit"
          type="number"
          min="1"
          step="1"
          placeholder={conversationLimitDefault !== null ? `Plan: ${conversationLimitDefault}` : "Plan: no limit"}
          defaultValue={conversationLimitOverride ?? ""}
          className={`w-40 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        AI cost cap override (USD)
        <input
          name="aiCostLimitUsd"
          type="number"
          min="0"
          step="0.01"
          placeholder={aiCostLimitDefault !== null ? `Plan: $${aiCostLimitDefault}` : "Plan: no cap"}
          defaultValue={aiCostLimitOverride ?? ""}
          className={`w-40 ${input}`}
        />
      </label>
      <button type="submit" name="intent" value="save" disabled={pending} className={button}>
        Save Overrides
      </button>
      <button
        type="submit"
        name="intent"
        value="reset"
        disabled={pending || !hasOverride}
        className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Reset to Plan Defaults
      </button>
      <Result message={message} />
    </form>
  );
}

export function UsageSettingsForm({
  locale,
  conversationWarningPercents,
  aiCostWarningPercent,
  trialConversationLimit,
  trialAiCostLimitUsd,
}: {
  locale: string;
  conversationWarningPercents: number[];
  aiCostWarningPercent: number;
  trialConversationLimit: number | null;
  trialAiCostLimitUsd: number | null;
}) {
  const [message, formAction, pending] = useActionState(updateUsageSettingsAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="locale" value={locale} />
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Conversation warning levels (%)
        <input
          name="conversationWarningPercents"
          required
          defaultValue={conversationWarningPercents.join(", ")}
          className={`w-44 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        AI cost warning at (%)
        <input
          name="aiCostWarningPercent"
          type="number"
          min="1"
          max="100"
          step="1"
          required
          defaultValue={aiCostWarningPercent}
          className={`w-28 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Trial conversations
        <input
          name="trialConversationLimit"
          type="number"
          min="1"
          step="1"
          placeholder="No limit"
          defaultValue={trialConversationLimit ?? ""}
          className={`w-32 ${input}`}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Trial AI allowance (USD)
        <input
          name="trialAiCostLimitUsd"
          type="number"
          min="0"
          step="0.01"
          placeholder="No cap"
          defaultValue={trialAiCostLimitUsd ?? ""}
          className={`w-32 ${input}`}
        />
      </label>
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Saving…" : "Save settings"}
      </button>
      <Result message={message} />
    </form>
  );
}
