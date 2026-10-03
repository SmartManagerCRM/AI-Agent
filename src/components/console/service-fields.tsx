import { useTranslations } from "next-intl";

import { Msg, RichMsg } from "@/components/i18n/msg";

/** The fields of a bookable service, shared by Add service and Edit (plain inputs: works in server-action forms). */
export type ServiceFieldValues = {
  name: string;
  description: string;
  durationMinutes: number | null;
  priceMajor: string;
  priceUnit: "booking" | "hour" | "person";
  capacity: number;
  customerSetsEnd: boolean;
  onlineBooking: boolean;
  /** Agent bookings wait for the business to confirm them. */
  requiresApproval: boolean;
};

export const EMPTY_SERVICE: ServiceFieldValues = {
  name: "",
  description: "",
  durationMinutes: 30,
  priceMajor: "",
  priceUnit: "booking",
  capacity: 1,
  customerSetsEnd: false,
  onlineBooking: true,
  requiresApproval: false,
};

const input = "rounded-md border border-neutral-300 px-3 py-2";

export function ServiceFields({ values, exponent }: { values: ServiceFieldValues; exponent: number }) {
  const t = useTranslations("console.serviceFields");
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 sm:col-span-2">
        <Msg id="console.serviceFields.name" />
        <input name="name" required maxLength={160} defaultValue={values.name} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <Msg id="console.serviceFields.durationMinutes" />{" "}<span className="text-xs text-slate-400"><Msg id="console.serviceFields.optional" /></span>
        <input
          name="durationMinutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={values.durationMinutes ?? ""}
          placeholder={t("noFixedLength")}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        <Msg id="console.serviceFields.capacity" />{" "}<span className="text-xs text-slate-400"><Msg id="console.serviceFields.peopleAtTheSameTime" /></span>
        <input name="capacity" type="number" min={1} max={500} required defaultValue={values.capacity} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        <Msg id="console.serviceFields.price" />{" "}<span className="text-xs text-slate-400"><Msg id="console.serviceFields.optionalEmptyOnRequest" /></span>
        <input
          name="priceMajor"
          type="number"
          step={1 / 10 ** exponent}
          min={0}
          defaultValue={values.priceMajor}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        <Msg id="console.serviceFields.priceIs" />
        <select name="priceUnit" defaultValue={values.priceUnit} className={input}>
          <option value="booking">{t("perBooking")}</option>
          <option value="hour">{t("perHour")}</option>
          <option value="person">{t("perPerson")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        <Msg id="console.serviceFields.description" />{" "}<span className="text-xs text-slate-400"><Msg id="console.serviceFields.optionalShownToCustomersBefore" /></span>
        <textarea name="description" rows={2} maxLength={1000} defaultValue={values.description} className={input} />
      </label>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" name="customerSetsEnd" defaultChecked={values.customerSetsEnd} className="mt-1 h-4 w-4 accent-emerald-600" />
        <span>
          <RichMsg id="console.serviceFields.customersChooseTimeOut" values={{ strong: (c) => <strong>{c}</strong> }} />
          <span className="block text-xs text-slate-500"><Msg id="console.serviceFields.forHourlyRentalsCourtsRooms" /></span>
        </span>
      </label>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" name="onlineBooking" defaultChecked={values.onlineBooking} className="mt-1 h-4 w-4 accent-emerald-600" data-testid="service-online" />
        <span>
          <strong><Msg id="console.serviceFields.bookableOnYourAgent" /></strong>
          <span className="block text-xs text-slate-500"><Msg id="console.serviceFields.showsOnYourAgentS" /></span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4" data-testid="service-confirmation">
        <legend className="mb-1 font-medium text-slate-700"><Msg id="console.serviceFields.whenACustomerBooksOn" /></legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
            <input type="radio" name="confirmation" value="instant" defaultChecked={!values.requiresApproval} className="mt-1 accent-emerald-600" />
            <span>
              <strong><Msg id="console.serviceFields.confirmAutomatically" /></strong>
              <span className="block text-xs text-slate-500"><Msg id="console.serviceFields.theBookingIsConfirmedAt" /></span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
            <input type="radio" name="confirmation" value="manual" defaultChecked={values.requiresApproval} className="mt-1 accent-emerald-600" />
            <span>
              <strong><Msg id="console.serviceFields.iConfirmEachRequest" /></strong>
              <span className="block text-xs text-slate-500">
                <Msg id="console.serviceFields.theCustomerWaitsWhileYou" />
              </span>
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
