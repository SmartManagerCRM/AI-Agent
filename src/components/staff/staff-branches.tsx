"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { setStaffBranchesAction } from "@/server/staff/actions";

import { BranchChoices } from "./invite-staff-form";

type Branch = { id: string; name: string };

/** A staff member's branches, and changing them (owner/admin). */
export function StaffBranches({
  memberId,
  locale,
  slug,
  branches,
  current,
}: {
  memberId: string;
  locale: string;
  slug: string;
  branches: Branch[];
  current: string[];
}) {
  const t = useTranslations("console.staff");
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<typeof setStaffBranchesAction>>, formData: FormData) => {
    const next = await setStaffBranchesAction(prev, formData);
    if (next?.ok) setEditing(false);
    return next;
  }, undefined);
  const names = branches.filter((b) => current.includes(b.id)).map((b) => b.name);

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center gap-1.5" data-testid="staff-branches">
        {names.length > 0 ? (
          names.map((n) => (
            <span key={n} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
              {n}
            </span>
          ))
        ) : (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200">{t("noBranch")}</span>
        )}
        <button type="button" onClick={() => setEditing(true)} className="text-xs font-medium text-emerald-600 hover:underline">
          {t("editBranches")}
        </button>
        {state?.ok && <span className="text-xs text-emerald-700">{state.message}</span>}
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2" data-testid="staff-branches-form">
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <BranchChoices branches={branches} selected={current} legend={t("worksAt")} />
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {t("saveBranches")}
        </button>
        <button type="button" onClick={() => setEditing(false)} className="text-xs text-slate-600 hover:underline">
          {t("cancel")}
        </button>
      </div>
      {state && !state.ok && <p className="text-xs text-red-600">{state.message}</p>}
    </form>
  );
}
