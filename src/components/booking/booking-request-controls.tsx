"use client";

import { useActionState } from "react";

import { decideBookingAction } from "@/server/booking/actions";

/** Confirm / Decline for a booking request from the Agent. */
export function DecideBooking({ bookingId, locale, slug, compact = false }: { bookingId: string; locale: string; slug: string; compact?: boolean }) {
  const [state, formAction, pending] = useActionState(decideBookingAction, undefined);
  const size = compact ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm";
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2" data-testid="decide-booking">
      <input type="hidden" name="bookingId" value={bookingId} />
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="slug" value={slug} />
      <button
        type="submit"
        name="decision"
        value="confirm"
        disabled={pending}
        className={`${size} rounded-lg bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50`}
      >
        Confirm
      </button>
      <button
        type="submit"
        name="decision"
        value="decline"
        disabled={pending}
        onClick={(e) => {
          if (!window.confirm("Decline this request? The customer is told, politely, that the time is fully booked.")) e.preventDefault();
        }}
        className={`${size} rounded-lg font-semibold text-red-600 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50`}
      >
        Decline
      </button>
      {state && <span role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.message}</span>}
    </form>
  );
}

/** Opens WhatsApp with the message ready; the owner checks it and presses Send. */
export function WhatsAppButton({ href, label, compact = false }: { href: string; label: string; compact?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      data-testid="booking-whatsapp"
      className={`inline-flex items-center gap-1.5 rounded-lg bg-[#25D366] font-semibold text-white shadow-sm hover:bg-[#1ebe5b] ${compact ? "px-2 py-1 text-xs" : "px-3.5 py-2 text-sm"}`}
    >
      <svg viewBox="0 0 24 24" className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} fill="currentColor" aria-hidden>
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.13c-.24.68-1.42 1.3-1.96 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.16-4.94-4.36-.14-.19-1.18-1.57-1.18-3s.75-2.13 1.02-2.42c.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.65.5.24.58.82 2.01.89 2.15.07.15.12.32.02.51-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.3-.13.6.17.29.76 1.25 1.63 2.02 1.12 1 2.06 1.31 2.36 1.46.29.14.46.12.63-.07.17-.19.73-.85.92-1.15.2-.29.39-.24.65-.14.27.1 1.7.8 1.99.95.29.14.48.22.55.34.07.12.07.7-.17 1.38Z" />
      </svg>
      WhatsApp
    </a>
  );
}
