"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/console/button";
import { createConsoleBookingAction } from "@/server/booking/actions";

export type BookingServiceOption = {
  id: string;
  name: string;
  durationMinutes: number | null;
  customerSetsEnd: boolean;
  capacity: number;
};

const input = "rounded-md border border-neutral-300 px-3 py-2";

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = (h * 60 + m + minutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/** Bookings → New booking: book a customer in by hand (phone call, walk-in). The service's own rules decide which times apply. */
export function NewBookingForm({ locale, slug, services, today }: { locale: string; slug: string; services: BookingServiceOption[]; today: string }) {
  const [state, formAction, pending] = useActionState(createConsoleBookingAction, undefined);
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [timeIn, setTimeIn] = useState("10:00");
  const service = services.find((s) => s.id === serviceId) ?? services[0];
  if (!service) return <p className="text-sm text-slate-500">Add a service first.</p>;
  // Fixed length: the time out follows the duration. Otherwise the time out (or a duration) is optional.
  const fixed = service.durationMinutes !== null && !service.customerSetsEnd;

  return (
    <form action={formAction} className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4" data-testid="new-booking-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <label className="flex flex-col gap-1 sm:col-span-2">
        Service
        <select name="serviceId" value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={input}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        Date
        <input name="date" type="date" required min={today} defaultValue={today} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Time in
        <input name="timeIn" type="time" required value={timeIn} onChange={(e) => setTimeIn(e.target.value)} className={input} />
      </label>
      {fixed ? (
        <p className="flex flex-col gap-1 sm:col-span-2">
          Time out
          <span className="rounded-md bg-slate-50 px-3 py-2 text-slate-600">
            {timeIn ? addMinutes(timeIn, service.durationMinutes!) : "—"} ({service.durationMinutes} min)
          </span>
        </p>
      ) : (
        <>
          <label className="flex flex-col gap-1">
            Time out <span className="text-xs text-slate-400">optional</span>
            <input name="timeOut" type="time" className={input} />
          </label>
          <label className="flex flex-col gap-1">
            or duration (min) <span className="text-xs text-slate-400">optional</span>
            <input
              name="durationMinutes"
              type="number"
              min={1}
              max={1440}
              placeholder={service.durationMinutes ? String(service.durationMinutes) : "open-ended"}
              className={input}
            />
          </label>
        </>
      )}
      <label className="flex flex-col gap-1">
        People
        <input name="partySize" type="number" min={1} max={service.capacity} defaultValue={1} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Customer name
        <input name="name" required maxLength={120} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Phone
        <input name="phone" type="tel" required maxLength={40} className={input} />
      </label>
      <label className="flex flex-col gap-1">
        Email <span className="text-xs text-slate-400">optional</span>
        <input name="email" type="email" maxLength={200} className={input} />
      </label>
      <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-4">
        Notes <span className="text-xs text-slate-400">optional</span>
        <input name="notes" maxLength={1000} className={input} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? "Booking…" : "Add booking"}
        </Button>
        {state && (
          <p role="status" className={state.ok ? "text-emerald-700" : "text-red-600"}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
