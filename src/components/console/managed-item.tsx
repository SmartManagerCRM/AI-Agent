"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useActionState, useState } from "react";

import { IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";

/** What an edit / delete answers: shown under the row; `ok` closes the editor. */
export type ManageResult = { ok: boolean; message?: string } | undefined;
export type ManageAction = (prev: ManageResult, formData: FormData) => Promise<ManageResult>;

export type EditField = {
  name: string;
  label: string;
  defaultValue?: string | number | null;
  type?: "text" | "textarea" | "number" | "email" | "tel" | "date" | "datetime-local" | "select";
  options?: { value: string; label: string }[];
  required?: boolean;
  maxLength?: number;
  min?: number;
  step?: string;
  dir?: "auto" | "ltr";
};

const input = "rounded-md border border-neutral-300 px-2 py-1.5 text-sm";

function EditFields({ fields }: { fields: EditField[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.name} className={`flex flex-col gap-1 ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
          <span className="text-xs text-slate-500">{f.label}</span>
          {f.type === "textarea" ? (
            <textarea name={f.name} defaultValue={f.defaultValue ?? ""} required={f.required} maxLength={f.maxLength} rows={3} dir={f.dir ?? "auto"} className={input} />
          ) : f.type === "select" ? (
            <select name={f.name} defaultValue={String(f.defaultValue ?? "")} className={input}>
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              name={f.name}
              type={f.type ?? "text"}
              defaultValue={f.defaultValue ?? ""}
              required={f.required}
              maxLength={f.maxLength}
              min={f.min}
              step={f.step}
              dir={f.dir ?? (f.type === "email" || f.type === "tel" ? "ltr" : "auto")}
              className={input}
            />
          )}
        </label>
      ))}
    </div>
  );
}

/**
 * One row of something a business added (a category, branch, customer, order,
 * table, coupon, lead, booking, member…): its details, and Edit, Suspend /
 * Activate and Delete — the same three controls everywhere in the console.
 * Delete asks first; a refusal (e.g. "a paid order can't be deleted") shows here.
 */
export function ManagedItem({
  testId,
  title,
  details,
  badges,
  hidden,
  fields,
  update,
  active,
  toggle,
  remove,
  deleteConfirm,
  extra,
}: {
  testId?: string;
  title: ReactNode;
  details?: ReactNode;
  badges?: ReactNode;
  /** Hidden inputs sent with every action (ids, locale, slug). */
  hidden: Record<string, string>;
  fields?: EditField[];
  update?: ManageAction;
  /** Present when the item can be suspended: whether it is active now. */
  active?: boolean;
  toggle?: ManageAction;
  remove?: ManageAction;
  deleteConfirm?: string;
  extra?: ReactNode;
}) {
  const t = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const noop: ManageAction = async () => undefined;
  // Closes the editor once the change is saved.
  const [saved, saveAction, saving] = useActionState<ManageResult, FormData>(async (prev, formData) => {
    const result = await (update ?? noop)(prev, formData);
    if (result?.ok) setEditing(false);
    return result;
  }, undefined);
  const [toggled, toggleAction, toggling] = useActionState(toggle ?? noop, undefined);
  const [removed, removeAction, removing] = useActionState(remove ?? noop, undefined);
  const message = [saved, toggled, removed].find((r) => r && !r.ok && r.message)?.message;
  const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);

  return (
    <li
      data-testid={testId}
      className={`rounded-lg border px-4 py-3 text-sm ${active === false ? "border-slate-200 bg-slate-50 text-slate-500" : "border-neutral-200 bg-white"}`}
    >
      {editing && update && fields ? (
        <form action={saveAction} className="flex flex-col gap-2" data-testid={testId ? `${testId}-edit` : undefined}>
          {hiddenInputs}
          <EditFields fields={fields} />
          <div className="flex gap-2">
            <Button type="submit" disabled={saving} className="px-3 py-1.5">
              {saving ? t("saving") : t("save")}
            </Button>
            <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setEditing(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">
              {title}
              {active === false && (
                <span className="ms-2 rounded bg-amber-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-amber-700">{t("suspended")}</span>
              )}
              {badges}
            </p>
            {details && <div className="mt-0.5 text-xs text-slate-500">{details}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {extra}
            {update && fields && <IconButton icon="edit" label={t("edit")} onClick={() => setEditing(true)} />}
            {toggle && active !== undefined && (
              <form action={toggleAction}>
                {hiddenInputs}
                <input type="hidden" name="value" value={active ? "false" : "true"} />
                {active ? (
                  <IconButton type="submit" icon="pause" label={t("suspend")} tone="amber" disabled={toggling} />
                ) : (
                  <IconButton type="submit" icon="play" label={t("activate")} tone="emerald" disabled={toggling} />
                )}
              </form>
            )}
            {remove && (
              <form
                action={removeAction}
                onSubmit={(event) => {
                  if (deleteConfirm && !window.confirm(deleteConfirm)) event.preventDefault();
                }}
              >
                {hiddenInputs}
                <IconButton type="submit" icon="trash" label={t("delete")} tone="red" disabled={removing} />
              </form>
            )}
          </div>
        </div>
      )}
      {message && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {message}
        </p>
      )}
    </li>
  );
}

/**
 * One icon button posting to a manage action (Suspend / Activate in a table
 * row, "Make main branch"…); a refusal shows next to it.
 */
export function ManageActionButton({
  action,
  hidden,
  icon,
  label,
  tone,
  confirm: question,
  testId,
}: {
  action: ManageAction;
  hidden: Record<string, string>;
  icon: Parameters<typeof IconButton>[0]["icon"];
  label: string;
  tone?: Parameters<typeof IconButton>[0]["tone"];
  confirm?: string;
  testId?: string;
}) {
  const [result, formAction, pending] = useActionState(action, undefined);
  return (
    <form
      action={formAction}
      data-testid={testId}
      className="inline-flex items-center gap-1"
      onSubmit={(event) => {
        if (question && !window.confirm(question)) event.preventDefault();
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <IconButton type="submit" icon={icon} label={label} tone={tone} disabled={pending} />
      {result && !result.ok && result.message && (
        <span role="alert" className="max-w-48 text-xs text-red-600">
          {result.message}
        </span>
      )}
    </form>
  );
}

/**
 * The same Edit / Suspend-Activate / Delete for an item shown as a table row
 * (orders, coupons, leads, bookings, members, staff): icon buttons, and the
 * editor in a dialog.
 */
export function ManageControls({
  testId,
  heading,
  hidden,
  fields,
  update,
  active,
  toggle,
  remove,
  deleteConfirm,
  removeLabel,
}: {
  testId?: string;
  heading: string;
  hidden: Record<string, string>;
  fields?: EditField[];
  update?: ManageAction;
  active?: boolean;
  toggle?: ManageAction;
  remove?: ManageAction;
  deleteConfirm?: string;
  removeLabel?: string;
}) {
  const t = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const noop: ManageAction = async () => undefined;
  // Closes the editor once the change is saved.
  const [saved, saveAction, saving] = useActionState<ManageResult, FormData>(async (prev, formData) => {
    const result = await (update ?? noop)(prev, formData);
    if (result?.ok) setEditing(false);
    return result;
  }, undefined);
  const [toggled, toggleAction, toggling] = useActionState(toggle ?? noop, undefined);
  const [removed, removeAction, removing] = useActionState(remove ?? noop, undefined);
  const message = [toggled, removed].find((r) => r && !r.ok && r.message)?.message;
  const hiddenInputs = Object.entries(hidden).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />);

  return (
    <span className="inline-flex flex-col" data-testid={testId}>
      <span className="inline-flex items-center gap-0.5">
        {update && fields && <IconButton icon="edit" label={t("edit")} onClick={() => setEditing(true)} />}
        {toggle && active !== undefined && (
          <form action={toggleAction}>
            {hiddenInputs}
            <input type="hidden" name="value" value={active ? "false" : "true"} />
            {active ? (
              <IconButton type="submit" icon="pause" label={t("suspend")} tone="amber" disabled={toggling} />
            ) : (
              <IconButton type="submit" icon="play" label={t("activate")} tone="emerald" disabled={toggling} />
            )}
          </form>
        )}
        {remove && (
          <form
            action={removeAction}
            onSubmit={(event) => {
              if (deleteConfirm && !window.confirm(deleteConfirm)) event.preventDefault();
            }}
          >
            {hiddenInputs}
            <IconButton type="submit" icon="trash" label={removeLabel ?? t("delete")} tone="red" disabled={removing} />
          </form>
        )}
      </span>
      {message && (
        <span role="alert" className="max-w-56 text-xs text-red-600">
          {message}
        </span>
      )}
      {editing && update && fields && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <form
            action={saveAction}
            className="flex max-h-full w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-xl bg-white p-5 text-start shadow-xl"
            data-testid={testId ? `${testId}-edit` : undefined}
          >
            {hiddenInputs}
            <h2 className="text-base font-semibold text-slate-900">{heading}</h2>
            <EditFields fields={fields} />
            {saved && !saved.ok && saved.message && (
              <p role="alert" className="text-xs text-red-600">
                {saved.message}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving} className="px-3 py-1.5">
                {saving ? t("saving") : t("save")}
              </Button>
              <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setEditing(false)}>
                {t("cancel")}
              </Button>
            </div>
          </form>
        </div>
      )}
    </span>
  );
}
