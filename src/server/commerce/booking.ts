import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type BookableService = { id: string; name: string; durationMinutes: number | null; priceMinor: number | null; customerSetsEnd?: boolean };
export type Slot = { startsAt: string; endsAt: string | null; localTime: string; spotsLeft: number };

/**
 * Real, server-validated booking (Customer Agent Master Prompt §26).
 * Availability and every booking are decided in Postgres
 * (`service_slots`, `book_service_at`): the business's own opening hours in
 * its own time zone, the service's capacity and the bookings already made —
 * never an invented slot.
 */
export async function findActiveServiceByName(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  name: string,
): Promise<BookableService | null> {
  const services = await listActiveServices(supabase, tenantId, locale);
  const needle = name.trim().toLowerCase();
  return services.find((s) => s.name.toLowerCase() === needle) ?? null;
}

/** Every active service, for the AI to list when a customer asks "what can I book?" without naming one. */
export async function listActiveServices(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
): Promise<BookableService[]> {
  const { data } = await supabase
    .from("bookable_services")
    .select("id, name, duration_minutes, price_minor, customer_sets_end")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .eq("online_booking", true)
    .is("archived_at", null);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name[locale] ?? Object.values(s.name)[0] ?? "",
    durationMinutes: s.duration_minutes,
    priceMinor: s.price_minor,
    customerSetsEnd: s.customer_sets_end,
  }));
}

/** Real open start times for one service on one local date ("YYYY-MM-DD" in the business's time zone), computed live. */
export async function getAvailableSlots(
  supabase: TypedSupabaseClient,
  tenantId: string,
  service: Pick<BookableService, "id">,
  dateISO: string,
  /** The branch (its hours and capacity); none = the main branch. */
  branchId: string | null = null,
): Promise<Slot[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return [];
  const { data, error } = await supabase.rpc("service_slots", {
    p_tenant_id: tenantId,
    p_service_id: service.id,
    p_date: dateISO,
    p_branch_id: branchId,
  });
  if (error || !data) return [];
  return data.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at, localTime: r.local_time, spotsLeft: r.spots_left }));
}

export type BookingRefusal = "unavailable" | "party_size" | "past" | "too_far" | "bad_time_out" | "closed" | "full" | "branch" | "invalid";
export type BookingStatus = "pending" | "confirmed";
export type BookResult =
  | { ok: true; bookingId: string; status: BookingStatus; startsAt: string; endsAt: string | null }
  | { ok: false; reason: BookingRefusal };

export function parseBookResult(data: unknown): BookResult {
  const r = (data ?? {}) as Record<string, unknown>;
  if (r.ok === true && typeof r.booking_id === "string" && typeof r.starts_at === "string") {
    return {
      ok: true,
      bookingId: r.booking_id,
      // A request the business confirms itself waits as "pending".
      status: r.status === "pending" ? "pending" : "confirmed",
      startsAt: r.starts_at,
      endsAt: typeof r.ends_at === "string" ? r.ends_at : null,
    };
  }
  const reason = typeof r.reason === "string" ? r.reason : "invalid";
  return { ok: false, reason: (["unavailable", "party_size", "past", "too_far", "bad_time_out", "closed", "full", "branch"].includes(reason) ? reason : "invalid") as BookingRefusal };
}

const REFUSAL_TEXT: Record<BookingRefusal, string> = {
  unavailable: "That service can't be booked right now.",
  party_size: "That's more people than this service can take at once.",
  past: "That time has already passed — please pick another.",
  too_far: "Bookings can be made up to a year ahead.",
  bad_time_out: "The time out must be after the time in (within 24 hours).",
  closed: "The business is closed at that time — please pick a time within opening hours.",
  full: "That time is fully booked — please pick another time.",
  branch: "Please choose which branch the booking is for.",
  invalid: "Could not create that booking — please try again.",
};

export type CreateBookingResult =
  | { ok: true; bookingId: string; status: BookingStatus; startsAt: string; endsAt: string | null }
  | { ok: false; error: string; reason: BookingRefusal };

/** A booking the AI chat makes: re-validated in the database (a second customer may have taken the slot since it was offered). */
export async function createBooking(
  supabase: TypedSupabaseClient,
  tenantId: string,
  service: BookableService,
  conversationId: string | null,
  startsAtISO: string,
  details: { name?: string; phone?: string; email?: string },
  /** The branch (businesses with several); none = the business's only/main one. */
  branchId: string | null = null,
): Promise<CreateBookingResult> {
  const startsAt = new Date(startsAtISO);
  if (Number.isNaN(startsAt.getTime())) return { ok: false, error: REFUSAL_TEXT.past, reason: "past" };
  const { data, error } = await supabase.rpc("book_service_at", {
    p_tenant_id: tenantId,
    p_service_id: service.id,
    p_starts_at: startsAt.toISOString(),
    p_ends_at: null,
    p_party_size: 1,
    p_customer_name: details.name ?? null,
    p_customer_phone: details.phone ?? null,
    p_customer_email: details.email ?? null,
    p_notes: null,
    p_source: "agent_chat",
    p_conversation_id: conversationId,
    p_branch_id: branchId,
  });
  if (error) return { ok: false, error: REFUSAL_TEXT.invalid, reason: "invalid" };
  const result = parseBookResult(data);
  return result.ok ? result : { ok: false, error: REFUSAL_TEXT[result.reason], reason: result.reason };
}

export async function cancelBookingById(
  supabase: TypedSupabaseClient,
  tenantId: string,
  bookingId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", bookingId)
    .eq("tenant_id", tenantId)
    .in("status", ["confirmed", "pending"]);
  return !error;
}
