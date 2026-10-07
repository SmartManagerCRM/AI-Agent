"use client";

import { useTranslations } from "next-intl";

import { AutoTranslatedChip } from "@/components/i18n/auto-translated";
import { useActionState, useState } from "react";

import { ActionIconForm, IconButton } from "@/components/catalog/item-controls";
import { Button } from "@/components/console/button";
import { ServiceFields } from "@/components/console/service-fields";
import {
  deleteServiceAction,
  setServiceActiveAction,
  updateServiceAction,
  type ServiceEditState,
} from "@/server/booking/actions";

export type ServiceRowData = {
  id: string;
  name: string;
  /** The name shown was translated automatically (not typed by anyone). */
  autoTranslated?: boolean;
  description: string;
  durationMinutes: number | null;
  priceMinor: number | null;
  priceLabel: string | null;
  priceUnit: "booking" | "hour" | "person";
  customerSetsEnd: boolean;
  onlineBooking: boolean;
  requiresApproval: boolean;
  isActive: boolean;
  source: "manual" | "brain" | "file_import";
};

/** One bookable service on Bookings: details, and edit / suspend (or activate) / delete. */
export function ServiceRow({
  service,
  exponent,
  locale,
  slug,
}: {
  service: ServiceRowData;
  exponent: number;
  locale: string;
  slug: string;
}) {
  const t = useTranslations("console.serviceRow");
  const tCommon = useTranslations("common");
  const tFields = useTranslations("console.serviceFields");
  const [state, formAction, pending] = useActionState(updateServiceAction, undefined);
  // Open with the result current at that moment; a newer successful save closes the form.
  const [opened, setOpened] = useState<{ at: ServiceEditState } | null>(null);
  const editing = opened !== null && !(state?.ok && state !== opened.at);
  const fields = { serviceId: service.id, locale, slug };

  if (editing) {
    return (
      <form
        action={formAction}
        className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2 text-sm"
        data-testid="service-edit-form"
      >
        <input type="hidden" name="serviceId" value={service.id} />
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="slug" value={slug} />
        <div className="basis-full">
          <ServiceFields
            exponent={exponent}
            values={{
              name: service.name,
              description: service.description,
              durationMinutes: service.durationMinutes,
              priceMajor: service.priceMinor === null ? "" : (service.priceMinor / 10 ** exponent).toFixed(exponent),
              priceUnit: service.priceUnit,
              customerSetsEnd: service.customerSetsEnd,
              onlineBooking: service.onlineBooking,
              requiresApproval: service.requiresApproval,
            }}
          />
        </div>
        <Button type="submit" disabled={pending} className="px-3 py-1.5">
          {pending ? tCommon("saving") : tCommon("save")}
        </Button>
        <Button type="button" variant="secondary" className="px-3 py-1.5" onClick={() => setOpened(null)}>
          {tCommon("cancel")}
        </Button>
        {state && !state.ok && <p className="basis-full text-xs text-red-600">{state.message}</p>}
      </form>
    );
  }

  return (
    <div
      className="flex items-center justify-between gap-3 rounded-md border border-slate-100 p-2 text-sm"
      data-testid="service-row"
    >
      <span className="text-slate-900">
        <strong className="font-medium">{service.name}</strong>
        {service.autoTranslated && <AutoTranslatedChip label={tCommon("autoTranslated")} hint={tCommon("autoTranslatedHint")} />} — {service.durationMinutes !== null ? t("minutes", { n: service.durationMinutes }) : tFields("noFixedLength")}
        {service.customerSetsEnd && t("customerSetsEnd")}
        {service.priceLabel && ` · ${service.priceLabel}${service.priceUnit === "hour" ? t("perHour") : service.priceUnit === "person" ? t("perPerson") : ""}`}
        <span
          className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${service.onlineBooking ? "bg-teal-50 text-teal-700" : "bg-slate-100 text-slate-500"}`}
        >
          {service.onlineBooking ? t("onAgent") : t("consoleOnly")}
        </span>
        {service.onlineBooking && (
          <span
            className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${service.requiresApproval ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}
          >
            {service.requiresApproval ? t("approval") : t("automatic")}
          </span>
        )}
        {service.source !== "manual" && (
          <span className="ms-2 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700">
            {service.source === "brain" ? t("fromBrain") : t("imported")}
          </span>
        )}
        <span
          className={`ms-2 rounded-full px-2 py-0.5 text-xs font-medium ${
            service.isActive ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {service.isActive ? tCommon("active") : tCommon("inactive")}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <IconButton icon="edit" label={tCommon("edit")} onClick={() => setOpened({ at: state })} />
        <ActionIconForm action={setServiceActiveAction} fields={{ ...fields, value: String(!service.isActive) }}>
          {service.isActive ? (
            <IconButton type="submit" icon="pause" label={t("suspend")} tone="amber" />
          ) : (
            <IconButton type="submit" icon="play" label={t("activate")} tone="emerald" />
          )}
        </ActionIconForm>
        <ActionIconForm
          action={deleteServiceAction}
          fields={fields}
          confirm={t("deleteConfirm", { name: service.name })}
        >
          <IconButton type="submit" icon="trash" label={tCommon("delete")} tone="red" />
        </ActionIconForm>
      </span>
    </div>
  );
}
