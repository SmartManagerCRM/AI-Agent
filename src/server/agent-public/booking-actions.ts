"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { resolvePublicTenant, resolveWidgetTenant } from "@/server/agent-public/tenant";
import { LOCALES } from "@/i18n/locales";
import { getAvailableSlots, parseBookResult, type BookingRefusal, type BookingStatus } from "@/server/commerce/booking";
import { dayWindows, windowLabels, type HoursWindow } from "@/lib/branch-hours";
import { bookingAlternatives, type BranchAvailability } from "@/server/commerce/booking-alternatives";
import { businessHasBranches, openBranchChoices, type BranchChoice } from "@/server/commerce/branch-choice";
import { isRateLimited } from "@/server/shared/rate-limit";
import { serviceClient } from "@/server/supabase/clients";

/**
 * The customer Agent's own booking form — a structured flow (pick a
 * service, a day, a time, your details), so it never calls an AI model and
 * costs nothing per booking. Every booking is validated in the database
 * (`book_service`): the chosen branch's opening hours in the business's
 * time zone, the service's capacity and the bookings already made.
 *
 * Booking itself is always open — a customer can book at any active branch
 * at any hour; the day and time they book must fit that branch's own hours.
 * When it can't take it, `otherBranchesAction` suggests the branches that can.
 */
type Surface = "external_agent" | "website_widget";

async function loadTenant(slug: string, surface: Surface) {
  return surface === "website_widget" ? resolveWidgetTenant(slug) : resolvePublicTenant(slug);
}

/**
 * The branches a customer may book at: every active one, open right now or
 * not. `hasBranches` false = the business has none (no choice to make).
 */
export async function bookingBranchesAction(
  slug: string,
  surface: Surface,
  locale: string,
): Promise<{ hasBranches: boolean; branches: BranchChoice[] } | null> {
  const tenant = await loadTenant(slug, surface);
  if (!tenant) return null;
  const supabase = serviceClient();
  if (!(await businessHasBranches(supabase, tenant.id))) return { hasBranches: false, branches: [] };
  return { hasBranches: true, branches: await openBranchChoices(supabase, tenant.id, "booking", LOCALES.includes(locale as never) ? locale : "en") };
}

export type ServiceDay = {
  /** Opening times that day ("09:00–17:00"); [] = closed; null = the business set no hours. */
  hours: string[] | null;
  /** The same hours as times, to check a time the customer types. */
  windows: HoursWindow[] | null;
  /** Free start times (local "HH:MM") with places left — for services with a fixed length. */
  slots: { time: string; spotsLeft: number }[];
};

const daySchema = z.object({ serviceId: z.uuid(), date: z.iso.date(), branchId: z.uuid().nullable().optional() });

export async function serviceDayAction(slug: string, surface: Surface, input: z.infer<typeof daySchema>): Promise<ServiceDay | null> {
  const parsed = daySchema.safeParse(input);
  if (!parsed.success) return null;
  const tenant = await loadTenant(slug, surface);
  if (!tenant) return null;
  const supabase = serviceClient();
  const [{ data: service }, { data: branch }] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("id, duration_minutes, customer_sets_end")
      .eq("tenant_id", tenant.id)
      .eq("id", parsed.data.serviceId)
      .eq("is_active", true)
      .eq("online_booking", true)
      .is("archived_at", null)
      .maybeSingle(),
    // The chosen branch's hours (else the main branch's).
    parsed.data.branchId
      ? supabase.from("branches").select("opening_hours").eq("tenant_id", tenant.id).eq("id", parsed.data.branchId).eq("is_active", true).maybeSingle()
      : supabase.from("branches").select("opening_hours").eq("tenant_id", tenant.id).eq("is_default", true).eq("is_active", true).maybeSingle(),
  ]);
  if (!service) return null;
  const windows = dayWindows(branch?.opening_hours, parsed.data.date);
  const fixed = service.duration_minutes !== null && !service.customer_sets_end;
  const slots = fixed ? await getAvailableSlots(supabase, tenant.id, service, parsed.data.date, parsed.data.branchId ?? null) : [];
  return { hours: windowLabels(windows), windows, slots: slots.map((s) => ({ time: s.localTime, spotsLeft: s.spotsLeft })) };
}

const otherSchema = z.object({
  serviceId: z.uuid(),
  date: z.iso.date(),
  time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  branchId: z.uuid().nullable(),
  locale: z.string().max(5),
});

/** Other branches that can take this service on that day (at that time, when given). */
export async function otherBranchesAction(slug: string, surface: Surface, input: z.infer<typeof otherSchema>): Promise<BranchAvailability[]> {
  const parsed = otherSchema.safeParse(input);
  if (!parsed.success) return [];
  const tenant = await loadTenant(slug, surface);
  if (!tenant) return [];
  const caller = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(`book-other:${tenant.id}:${caller}`, 60_000, 40)) return [];
  const supabase = serviceClient();
  const { data: service } = await supabase
    .from("bookable_services")
    .select("id, duration_minutes, customer_sets_end")
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.serviceId)
    .eq("is_active", true)
    .eq("online_booking", true)
    .is("archived_at", null)
    .maybeSingle();
  if (!service) return [];
  const d = parsed.data;
  return bookingAlternatives(supabase, tenant.id, service, d.date, d.time, d.branchId, LOCALES.includes(d.locale as never) ? d.locale : "en");
}

const bookSchema = z.object({
  serviceId: z.uuid(),
  date: z.iso.date(),
  timeIn: z.string().regex(/^\d{2}:\d{2}$/),
  timeOut: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  durationMinutes: z.number().int().min(1).max(1440).nullable(),
  partySize: z.number().int().min(1).max(500),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{6,25}$/),
  email: z.email().max(200).nullable(),
  notes: z.string().trim().max(500).nullable(),
  /** The language the customer is using, so the business can answer in it. */
  locale: z.enum(LOCALES).optional(),
  /** The branch chosen (any active one); none when the business has no branches. */
  branchId: z.uuid().nullable().optional(),
});

export type AgentBookingResult =
  | { ok: true; bookingId: string; status: BookingStatus; startsAt: string; endsAt: string | null }
  | { ok: false; reason: BookingRefusal | "branch_closed" | "name" | "phone" | "email" | "rate_limited" | "unavailable_agent" };

// A real person books a few times at most; this only stops a script filling the calendar.
const BOOK_WINDOW_MS = 10 * 60_000;
const BOOK_MAX = 8;

export async function bookServiceAction(slug: string, surface: Surface, input: z.infer<typeof bookSchema>): Promise<AgentBookingResult> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, reason: field === "name" ? "name" : field === "phone" ? "phone" : field === "email" ? "email" : "invalid" };
  }
  const tenant = await loadTenant(slug, surface);
  if (!tenant) return { ok: false, reason: "unavailable_agent" };
  // Booking doesn't open a conversation (it isn't one): the limit is per visitor address.
  const caller = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(`book:${tenant.id}:${caller}`, BOOK_WINDOW_MS, BOOK_MAX)) return { ok: false, reason: "rate_limited" };
  const supabase = serviceClient();
  const d = parsed.data;
  // The branch must be one of the business's active branches (what the customer was offered);
  // the database then checks the day and time against that branch's own hours.
  if (await businessHasBranches(supabase, tenant.id)) {
    const active = await openBranchChoices(supabase, tenant.id, "booking", d.locale ?? "en");
    const branchId = d.branchId ?? (active.length === 1 ? active[0].id : null);
    if (!branchId) return { ok: false, reason: "branch" };
    if (!active.some((b) => b.id === branchId)) return { ok: false, reason: "branch_closed" };
    d.branchId = branchId;
  }
  const { data, error } = await supabase.rpc("book_service", {
    p_tenant_id: tenant.id,
    p_service_id: d.serviceId,
    p_date: d.date,
    p_time_in: d.timeIn,
    p_time_out: d.timeOut,
    p_duration_minutes: d.timeOut ? null : d.durationMinutes,
    p_party_size: d.partySize,
    p_customer_name: d.name,
    p_customer_phone: d.phone,
    p_customer_email: d.email,
    p_notes: d.notes,
    p_source: "agent_form",
    p_branch_id: d.branchId ?? null,
  });
  if (error) return { ok: false, reason: "invalid" };
  const result = parseBookResult(data);
  if (result.ok && d.locale) {
    await supabase.from("bookings").update({ customer_locale: d.locale }).eq("tenant_id", tenant.id).eq("id", result.bookingId);
  }
  return result;
}

export type RequestStatus = "pending" | "confirmed" | "declined" | "canceled" | "completed";

/**
 * The answer to a booking request, for the customer's page while it waits.
 * Only the status is returned (no customer details): knowing the request's
 * id — given only to the customer who made it — is what lets you ask.
 */
export async function bookingStatusAction(slug: string, surface: Surface, bookingId: string): Promise<RequestStatus | null> {
  if (!z.uuid().safeParse(bookingId).success) return null;
  const tenant = await loadTenant(slug, surface);
  if (!tenant) return null;
  const caller = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (isRateLimited(`book-status:${tenant.id}:${caller}`, 60_000, 60)) return "pending";
  const { data } = await serviceClient().from("bookings").select("status").eq("tenant_id", tenant.id).eq("id", bookingId).maybeSingle();
  return data?.status ?? null;
}
