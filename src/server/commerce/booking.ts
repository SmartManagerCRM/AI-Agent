import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type BookableService = { id: string; name: string; durationMinutes: number; priceMinor: number | null };
export type Slot = { startsAt: string; endsAt: string };

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Real, server-validated booking (Customer Agent Master Prompt §26).
 * Availability always comes from the business's own real branch hours
 * minus its own already-confirmed bookings for that exact service — never
 * an invented slot. One resource per service (see the migration's own
 * doc comment for why that's an honest, not a fake, simplification.
 */
export async function findActiveServiceByName(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
  name: string,
): Promise<BookableService | null> {
  const { data } = await supabase
    .from("bookable_services")
    .select("id, name, duration_minutes, price_minor")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  const needle = name.trim().toLowerCase();
  const match = (data ?? []).find((s) => (s.name[locale] ?? Object.values(s.name)[0] ?? "").toLowerCase() === needle);
  if (!match) return null;
  return {
    id: match.id,
    name: match.name[locale] ?? Object.values(match.name)[0] ?? "",
    durationMinutes: match.duration_minutes,
    priceMinor: match.price_minor,
  };
}

/** Every active service, for the AI to list when a customer asks "what can I book?" without naming one. */
export async function listActiveServices(
  supabase: TypedSupabaseClient,
  tenantId: string,
  locale: string,
): Promise<BookableService[]> {
  const { data } = await supabase
    .from("bookable_services")
    .select("id, name, duration_minutes, price_minor")
    .eq("tenant_id", tenantId)
    .eq("is_active", true);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name[locale] ?? Object.values(s.name)[0] ?? "",
    durationMinutes: s.duration_minutes,
    priceMinor: s.price_minor,
  }));
}

/** Real open slots for one service on one calendar day (tenant-local date, "YYYY-MM-DD"), computed live — never cached, never invented. */
export async function getAvailableSlots(
  supabase: TypedSupabaseClient,
  tenantId: string,
  service: BookableService,
  dateISO: string,
): Promise<Slot[]> {
  const { data: branch } = await supabase
    .from("branches")
    .select("opening_hours")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle();
  if (!branch) return [];

  const date = new Date(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return [];
  const weekday = WEEKDAY_KEYS[(date.getUTCDay() + 6) % 7];
  const openingHours = branch.opening_hours as Record<string, { open: string; close: string }[]>;
  const windows = openingHours[weekday] ?? [];
  if (windows.length === 0) return [];

  const durationMs = service.durationMinutes * 60_000;
  const candidates: Slot[] = [];
  for (const window of windows) {
    const [openH, openM] = window.open.split(":").map(Number);
    const [closeH, closeM] = window.close.split(":").map(Number);
    let cursor = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), openH, openM);
    const closeMs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), closeH, closeM);
    while (cursor + durationMs <= closeMs) {
      candidates.push({
        startsAt: new Date(cursor).toISOString(),
        endsAt: new Date(cursor + durationMs).toISOString(),
      });
      cursor += durationMs;
    }
  }

  const now = Date.now();
  const future = candidates.filter((c) => new Date(c.startsAt).getTime() > now);
  if (future.length === 0) return [];

  const dayStart = new Date(`${dateISO}T00:00:00Z`).toISOString();
  const dayEnd = new Date(new Date(dayStart).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("bookings")
    .select("starts_at, ends_at")
    .eq("tenant_id", tenantId)
    .eq("service_id", service.id)
    .eq("status", "confirmed")
    .gte("starts_at", dayStart)
    .lt("starts_at", dayEnd);

  return future.filter((slot) => {
    const start = new Date(slot.startsAt).getTime();
    const end = new Date(slot.endsAt).getTime();
    return !(existing ?? []).some((b) => {
      const bStart = new Date(b.starts_at).getTime();
      const bEnd = new Date(b.ends_at).getTime();
      return start < bEnd && end > bStart;
    });
  });
}

export type CreateBookingResult =
  { ok: true; bookingId: string; startsAt: string; endsAt: string } | { ok: false; error: string };

/** Re-validates the slot is still free (a second customer may have taken it since it was offered) before writing — never trusts the caller's own belief that a slot is open. */
export async function createBooking(
  supabase: TypedSupabaseClient,
  tenantId: string,
  service: BookableService,
  conversationId: string | null,
  startsAtISO: string,
  details: { name?: string; phone?: string; email?: string },
): Promise<CreateBookingResult> {
  const startsAt = new Date(startsAtISO);
  if (Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
    return { ok: false, error: "That time isn't available anymore — please pick another slot." };
  }
  const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);

  const { data: conflicting } = await supabase
    .from("bookings")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("service_id", service.id)
    .eq("status", "confirmed")
    .lt("starts_at", endsAt.toISOString())
    .gt("ends_at", startsAt.toISOString())
    .limit(1);
  if ((conflicting ?? []).length > 0) {
    return { ok: false, error: "That slot was just booked by someone else — please pick another time." };
  }

  const { data: inserted, error } = await supabase
    .from("bookings")
    .insert({
      tenant_id: tenantId,
      service_id: service.id,
      conversation_id: conversationId,
      customer_name: details.name ?? null,
      customer_phone: details.phone ?? null,
      customer_email: details.email ?? null,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: "Could not create that booking — please try again." };

  return { ok: true, bookingId: inserted.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
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
    .eq("status", "confirmed");
  return !error;
}
