"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { setBranchDeliveryAction } from "@/server/manage/actions";

/** "Takes delivery orders: yes / no" for one branch, switched with a click. */
export function BranchDeliveryToggle({ hidden, delivers }: { hidden: Record<string, string>; delivers: boolean }) {
  const t = useTranslations("console.branches");
  const [result, formAction, pending] = useActionState(setBranchDeliveryAction, undefined);
  return (
    <form action={formAction} className="inline-flex items-center gap-2 text-xs" data-testid="branch-delivery">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="value" value={String(!delivers)} />
      <span className={delivers ? "text-emerald-700" : "text-slate-500"}>{delivers ? t("delivers") : t("noDelivery")}</span>
      <button type="submit" disabled={pending} className="font-medium text-emerald-600 hover:underline disabled:opacity-50">
        {delivers ? t("stopDelivery") : t("startDelivery")}
      </button>
      {result && !result.ok && <span className="text-red-600">{result.message}</span>}
    </form>
  );
}
