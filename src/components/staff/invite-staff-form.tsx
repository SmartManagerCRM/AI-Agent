"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { RichMsg } from "@/components/i18n/msg";

import { Button } from "@/components/console/button";
import { inviteStaffAction } from "@/server/staff/actions";

type Branch = { id: string; name: string };
type Props = { tenantId: string; locale: string; slug: string; branches: Branch[] };

export function InviteStaffForm({ tenantId, locale, slug, branches }: Props) {
  const t = useTranslations("console.staff");
  const [state, formAction, pending] = useActionState(inviteStaffAction, undefined);
  const [role, setRole] = useState<"staff" | "business_admin">("staff");

  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3" data-testid="invite-staff-form">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={slug} />
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm">
            {t("email")}
            <input
              type="email"
              name="email"
              required
              placeholder={t("placeholder")}
              className="rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("role")}
            <select
              name="roleKey"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
              className="rounded-md border border-neutral-300 px-3 py-2"
            >
              <option value="staff">{t("staffRole")}</option>
              <option value="business_admin">{t("admin")}</option>
            </select>
          </label>
          <Button type="submit" disabled={pending}>
            {t("inviteButton")}
          </Button>
        </div>
        {branches.length > 0 &&
          (role === "staff" ? (
            <BranchChoices
              branches={branches}
              selected={branches.length === 1 ? [branches[0].id] : []}
              legend={t("worksAt")}
              hint={t("staffSees")}
            />
          ) : (
            <p className="text-xs text-slate-500">{t("adminSees")}</p>
          ))}
      </form>

      {state && "error" in state && <p className="text-sm text-red-600">{state.error}</p>}
      {state && "inviteLink" in state && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
          <p>
            <RichMsg id="console.staff.created" values={{ email: state.email, b: (c) => <span className="font-medium">{c}</span> }} />
          </p>
          <p className="mt-1 break-all font-mono text-xs text-slate-700">{state.inviteLink}</p>
        </div>
      )}
    </div>
  );
}

/** Checkboxes named `branchIds` — the branches a staff member works at. */
export function BranchChoices({
  branches,
  selected,
  legend,
  hint,
}: {
  branches: Branch[];
  selected: string[];
  legend: string;
  hint?: string;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="branch-choices">
      <legend className="mb-1 text-sm font-medium text-slate-700">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {branches.map((b) => (
          <label
            key={b.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm has-[:checked]:border-emerald-400 has-[:checked]:bg-emerald-50"
          >
            <input type="checkbox" name="branchIds" value={b.id} defaultChecked={selected.includes(b.id)} className="h-4 w-4" />
            {b.name}
          </label>
        ))}
      </div>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </fieldset>
  );
}
