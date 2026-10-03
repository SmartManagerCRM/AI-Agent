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
  return (
    <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <label className="flex flex-col gap-1 sm:col-span-2">
        Name
        <input name="name" required maxLength={160} defaultValue={values.name} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Duration (minutes) <span className="text-xs text-slate-400">optional</span>
        <input
          name="durationMinutes"
          type="number"
          min={1}
          max={1440}
          defaultValue={values.durationMinutes ?? ""}
          placeholder="no fixed length"
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1">
        Capacity <span className="text-xs text-slate-400">people at the same time</span>
        <input name="capacity" type="number" min={1} max={500} required defaultValue={values.capacity} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Price <span className="text-xs text-slate-400">optional — empty = on request</span>
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
        Price is
        <select name="priceUnit" defaultValue={values.priceUnit} className={input}>
          <option value="booking">per booking</option>
          <option value="hour">per hour</option>
          <option value="person">per person</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2">
        Description <span className="text-xs text-slate-400">optional — shown to customers before they book</span>
        <textarea name="description" rows={2} maxLength={1000} defaultValue={values.description} className={input} />
      </label>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" name="customerSetsEnd" defaultChecked={values.customerSetsEnd} className="mt-1 h-4 w-4 accent-emerald-600" />
        <span>
          Customers choose their <strong>time out</strong> (or how long they stay)
          <span className="block text-xs text-slate-500">For hourly rentals, courts, rooms, open sessions. Otherwise the time out follows the duration.</span>
        </span>
      </label>
      <label className="flex items-start gap-2 sm:col-span-2">
        <input type="checkbox" name="onlineBooking" defaultChecked={values.onlineBooking} className="mt-1 h-4 w-4 accent-emerald-600" data-testid="service-online" />
        <span>
          <strong>Bookable on your Agent</strong>
          <span className="block text-xs text-slate-500">Shows on your Agent&apos;s landing page so customers can book it themselves.</span>
        </span>
      </label>
      <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-4" data-testid="service-confirmation">
        <legend className="mb-1 font-medium text-slate-700">When a customer books on your Agent</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
            <input type="radio" name="confirmation" value="instant" defaultChecked={!values.requiresApproval} className="mt-1 accent-emerald-600" />
            <span>
              <strong>Confirm automatically</strong>
              <span className="block text-xs text-slate-500">The booking is confirmed at once when the time is free.</span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 has-[:checked]:border-emerald-500 has-[:checked]:bg-emerald-50">
            <input type="radio" name="confirmation" value="manual" defaultChecked={values.requiresApproval} className="mt-1 accent-emerald-600" />
            <span>
              <strong>I confirm each request</strong>
              <span className="block text-xs text-slate-500">
                The customer waits while you check; the request reaches you at once with a sound, and you confirm or decline it here.
              </span>
            </span>
          </label>
        </div>
      </fieldset>
    </div>
  );
}
