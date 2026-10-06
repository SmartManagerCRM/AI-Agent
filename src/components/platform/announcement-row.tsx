"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { ActionIconForm, IconButton } from "@/components/catalog/item-controls";
import { deleteAnnouncementAction, setAnnouncementActiveAction, updateAnnouncementAction } from "@/server/platform/announcement-actions";

type Announcement = {
  id: string;
  /** In the console's language (its translation, else the original). */
  text: string;
  severity: "info" | "warning";
  isActive: boolean;
  createdAt: string;
  /** Written in this language (editing it redoes the translations), else this language's wording. */
  original: boolean;
};

/** One announcement: shown, hidden, edited in place, or deleted (after asking). */
export function AnnouncementRow({ announcement: a, locale }: { announcement: Announcement; locale: string }) {
  const t = useTranslations("platform.announcements");
  const [editing, setEditing] = useState(false);
  const [error, formAction, pending] = useActionState(async (prev: string | undefined, formData: FormData) => {
    const result = await updateAnnouncementAction(prev, formData);
    if (!result) setEditing(false);
    return result;
  }, undefined);

  if (editing) {
    return (
      <form action={formAction} className="flex flex-col gap-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-3 text-sm" data-testid="announcement-edit">
        <input type="hidden" name="id" value={a.id} />
        <input type="hidden" name="locale" value={locale} />
        <label className="flex flex-col gap-1">
          {t("form.message")}
          <textarea name="message" required maxLength={500} rows={2} defaultValue={a.text} dir="auto" className="rounded-md border border-neutral-300 bg-white px-3 py-2" />
          <span className="text-xs text-slate-500">{a.original ? t("editOriginal") : t("editTranslation", { lang: locale.toUpperCase() })}</span>
        </label>
        <div className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1">
            {t("form.severity")}
            <select name="severity" defaultValue={a.severity} className="rounded-md border border-neutral-300 bg-white px-3 py-2">
              <option value="info">{t("severity.info")}</option>
              <option value="warning">{t("severity.warning")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" name="active" defaultChecked={a.isActive} />
            {t("shown")}
          </label>
          <div className="ms-auto flex gap-2">
            <button type="button" onClick={() => setEditing(false)} className="rounded-md px-3 py-2 text-slate-600 hover:bg-slate-100">
              {t("cancel")}
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-neutral-900 px-4 py-2 font-medium text-white disabled:opacity-50">
              {t("save")}
            </button>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-slate-100 p-3 text-sm" data-testid="announcement-row">
      <div className="min-w-0">
        <p className={a.isActive ? "text-slate-900" : "text-slate-400"} dir="auto">
          {a.text}
        </p>
        <p className="text-xs text-slate-400">
          {t(`severity.${a.severity}`)} · {new Date(a.createdAt).toLocaleString(locale)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <ActionIconForm action={setAnnouncementActiveAction} fields={{ id: a.id, value: String(!a.isActive), locale }}>
          <button type="submit" className="me-1 text-xs font-medium text-emerald-600 hover:underline">
            {a.isActive ? t("active") : t("inactive")}
          </button>
        </ActionIconForm>
        <IconButton icon="edit" label={t("edit")} onClick={() => setEditing(true)} />
        <ActionIconForm action={deleteAnnouncementAction} fields={{ id: a.id, locale }} confirm={t("deleteConfirm")}>
          <IconButton icon="trash" label={t("delete")} tone="red" type="submit" />
        </ActionIconForm>
      </div>
    </div>
  );
}
