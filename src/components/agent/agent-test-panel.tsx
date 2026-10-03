"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { testAgentMessageAction } from "@/server/ai/actions";

type Props = { tenantId: string; currency: string; slug: string; locale: string };

export function AgentTestPanel({ tenantId, currency, slug, locale }: Props) {
const t = useTranslations("console.agentTest");
  const [state, formAction, pending] = useActionState(testAgentMessageAction, undefined);

  return (
    <div className="flex max-w-md flex-col gap-3">
      <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
        {t("notice")}
      </p>
      <form action={formAction} className="flex gap-2">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="currency" value={currency} />
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="locale" value={locale} />
        <input
          name="message"
          required
          placeholder={t("placeholder")}
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t("send")}
        </button>
      </form>

      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "result" in state && (
        <div className="rounded-md border border-neutral-200 p-3 text-sm">
          <p className="text-neutral-500">{t("you", { message: state.message })}</p>
          <p className="mt-1 font-medium">{state.result.reply}</p>
          <p className="mt-2 text-xs text-neutral-400">
            {state.result.handledBy === "deterministic"
              ? t("deterministic", { rule: state.result.rule })
              : "provider" in state.result
                ? t("byAi", { provider: state.result.provider, model: state.result.model, fallback: state.result.fallbackUsed ? t("fallback") : "" })
                : t("failed", { error: state.result.error })}
          </p>
        </div>
      )}
    </div>
  );
}
