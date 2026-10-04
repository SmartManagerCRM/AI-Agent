"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";
import type { ManageResult } from "@/components/console/managed-item";
import { deleteOrderAction, updateOrderDetailsAction } from "@/server/manage/actions";

const input = "rounded-md border border-neutral-300 px-2 py-1.5 text-sm";

export type OrderDetails = {
  id: string;
  number: number;
  name: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  delivery: boolean;
};

/**
 * An order's Edit (its customer details — never its lines, prices or totals)
 * and Delete (refused once it's paid: cancel it instead). Suspending an order
 * is its Cancel status.
 */
export function OrderControls({ order, locale, slug }: { order: OrderDetails; locale: string; slug: string }) {
  const t = useTranslations("common");
  const tManage = useTranslations("console.manage");
  const [editing, setEditing] = useState(false);
  // Closes the editor once the change is saved.
  const [saved, saveAction, saving] = useActionState<ManageResult, FormData>(async (prev, formData) => {
    const result = await updateOrderDetailsAction(prev, formData);
    if (result?.ok) setEditing(false);
    return result;
  }, undefined);
  const [removed, removeAction, removing] = useActionState<ManageResult, FormData>(deleteOrderAction, undefined);
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="id" value={order.id} />
    </>
  );

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-0.5">
        <IconButton icon="edit" label={tManage("editDetails")} onClick={() => setEditing(true)} />
        <form
          action={removeAction}
          data-testid="order-delete"
          onSubmit={(event) => {
            if (!window.confirm(tManage("deleteOrder", { number: order.number }))) event.preventDefault();
          }}
        >
          {hidden}
          <IconButton type="submit" icon="trash" label={t("delete")} tone="red" disabled={removing} />
        </form>
      </span>
      {removed && !removed.ok && removed.message && (
        <span role="alert" className="max-w-56 text-xs text-red-600">
          {removed.message}
        </span>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
          <form action={saveAction} className="flex w-full max-w-lg flex-col gap-3 rounded-xl bg-white p-5 shadow-xl" data-testid="order-edit">
            {hidden}
            <h2 className="text-base font-semibold text-slate-900">
              {tManage("editDetails")} · #{order.number}
            </h2>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">{t("name")}</span>
                <input name="name" defaultValue={order.name} maxLength={120} dir="auto" className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-500">{t("phone")}</span>
                <input name="phone" type="tel" defaultValue={order.phone} maxLength={40} dir="ltr" className={input} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-slate-500">{t("email")}</span>
                <input name="email" type="email" defaultValue={order.email} maxLength={200} dir="ltr" className={input} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-slate-500">{tManage("deliveryAddress")}</span>
                <input name="address" defaultValue={order.address} maxLength={500} required={order.delivery} dir="auto" className={input} />
              </label>
              <label className="flex flex-col gap-1 sm:col-span-2">
                <span className="text-xs text-slate-500">{t("notes")}</span>
                <textarea name="notes" defaultValue={order.notes} maxLength={1000} rows={3} dir="auto" className={input} />
              </label>
            </div>
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
