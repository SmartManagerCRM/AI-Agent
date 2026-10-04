"use client";

import { useTranslations } from "next-intl";
import { useActionState, useState } from "react";

import { ActionIconForm, IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";
import { ManageActionButton } from "@/components/console/managed-item";
import { deleteCustomerAction, saveCustomerAction } from "@/server/customers/actions";
import { setCustomerActiveAction } from "@/server/manage/actions";

const input = "rounded-md border border-neutral-300 px-3 py-2";
const hint = "text-xs font-normal text-slate-400";

export type CustomerValues = {
  customerId?: string;
  name: string;
  phone: string;
  email: string;
  birthday: string;
  notes: string;
};

export const NEW_CUSTOMER: CustomerValues = { name: "", phone: "", email: "", birthday: "", notes: "" };

/** Add a customer (or edit a saved one): name, phone, email, birthday and notes. */
export function CustomerForm({
  locale,
  slug,
  initial,
  onDone,
}: {
  locale: string;
  slug: string;
  initial: CustomerValues;
  onDone?: () => void;
}) {
const t = useTranslations("console.customerForm");
const tCommon = useTranslations("common");
  const [state, formAction, pending] = useActionState(async (prev: Awaited<ReturnType<typeof saveCustomerAction>>, fd: FormData) => {
    const result = await saveCustomerAction(prev, fd);
    if (result?.ok) onDone?.();
    return result;
  }, undefined);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-3 text-sm"
      data-testid="customer-form"
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      {initial.customerId && <input type="hidden" name="customerId" value={initial.customerId} />}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1">
          {t("name")}
          <input name="name" required maxLength={120} defaultValue={initial.name} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("phone")} <span className={hint}>{tCommon("optional")}</span>
          <input name="phone" type="tel" maxLength={40} defaultValue={initial.phone} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("email")} <span className={hint}>{tCommon("optional")}</span>
          <input name="email" type="email" maxLength={200} defaultValue={initial.email} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          {t("birthday")} <span className={hint}>{tCommon("optional")}</span>
          <input name="birthday" type="date" defaultValue={initial.birthday} className={input} />
        </label>
        <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
          {t("notes")} <span className={hint}>{t("notesHint")}</span>
          <input name="notes" maxLength={1000} defaultValue={initial.notes} className={input} />
        </label>
      </div>
      <p className="text-xs text-slate-500">{t("matchHint")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? tCommon("saving") : initial.customerId ? t("saveCustomer") : t("addCustomer")}
        </Button>
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone}>
            {tCommon("cancel")}
          </Button>
        )}
        {state && (
          <p role="status" className={state.ok ? "text-emerald-700" : "text-red-600"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

export type CustomerListRow = {
  key: string;
  customerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  notes: string | null;
  /** Saved customers only: false once suspended. */
  isActive?: boolean;
  orderCount: number;
  totalSpent: string;
  lastOrder: string | null;
};

/** One row of the Customers table, with Edit / Delete for saved customers and Save for those known only from orders. */
export function CustomerRow({ row, locale, slug }: { row: CustomerListRow; locale: string; slug: string }) {
const t = useTranslations("console.customerForm");
const tCommon = useTranslations("common");
  const [editing, setEditing] = useState(false);
  const saved = row.customerId !== null;
  return (
    <>
      <tr className={`border-b border-slate-100 last:border-0 ${row.isActive === false ? "bg-slate-50 text-slate-500" : ""}`} data-testid="customer-row">
        <td className="px-4 py-3">
          <div className="flex items-center gap-2 font-medium text-slate-900">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
              {row.name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              {row.name}
              {saved && <span className="ms-2 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{t("saved")}</span>}
              {row.isActive === false && (
                <span className="ms-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{tCommon("suspended")}</span>
              )}
              {row.notes && <span className="block truncate text-xs font-normal text-slate-500">{row.notes}</span>}
            </span>
          </div>
        </td>
        <td className="px-4 py-3 text-slate-500">
          {row.phone || row.email ? (
            <>
              {row.phone && <span className="block">{row.phone}</span>}
              {row.email && <span className="block">{row.email}</span>}
            </>
          ) : (
            "—"
          )}
        </td>
        <td className="px-4 py-3 text-slate-700">{row.orderCount}</td>
        <td className="px-4 py-3 text-slate-700">{row.totalSpent}</td>
        <td className="px-4 py-3 text-slate-500">{row.lastOrder ?? "—"}</td>
        <td className="px-4 py-3">
          <span className="flex items-center justify-end gap-1">
            {saved ? (
              <>
                <IconButton icon="edit" label={tCommon("edit")} onClick={() => setEditing((v) => !v)} />
                <ManageActionButton
                  action={setCustomerActiveAction}
                  hidden={{ locale, slug, id: row.customerId!, value: row.isActive === false ? "true" : "false" }}
                  icon={row.isActive === false ? "play" : "pause"}
                  tone={row.isActive === false ? "emerald" : "amber"}
                  label={row.isActive === false ? tCommon("activate") : tCommon("suspend")}
                  testId="customer-toggle"
                />
                <ActionIconForm
                  action={deleteCustomerAction}
                  fields={{ locale, slug, customerId: row.customerId! }}
                  confirm={t("removeConfirm", { name: row.name })}
                >
                  <IconButton type="submit" icon="trash" label={tCommon("delete")} tone="red" />
                </ActionIconForm>
              </>
            ) : row.phone || row.email ? (
              // Only customers with a phone or email: that's how their orders are matched once saved.
              <IconButton icon="plus" label={t("saveAsCustomer")} tone="emerald" onClick={() => setEditing((v) => !v)} />
            ) : null}
          </span>
        </td>
      </tr>
      {editing && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={6} className="px-4 py-3">
            <CustomerForm
              locale={locale}
              slug={slug}
              initial={{
                customerId: row.customerId ?? undefined,
                name: row.name === "—" ? "" : row.name,
                phone: row.phone ?? "",
                email: row.email ?? "",
                birthday: row.birthday ?? "",
                notes: row.notes ?? "",
              }}
              onDone={() => setEditing(false)}
            />
          </td>
        </tr>
      )}
    </>
  );
}
