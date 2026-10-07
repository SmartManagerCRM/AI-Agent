"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseBookResult, type BookingRefusal } from "@/server/commerce/booking";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";
import { actionT } from "@/server/i18n/action-messages";

/** The fields a service form sends (create and edit share them). */
const serviceFieldsSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(1000).optional(),
  // Optional: empty = no fixed length.
  durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  priceMajor: z.coerce.number().min(0).max(1_000_000).optional(),
  priceUnit: z.enum(["booking", "hour", "person"]).default("booking"),
  capacity: z.coerce.number().int().min(1).max(500).default(1),
  customerSetsEnd: z.boolean(),
  onlineBooking: z.boolean(),
  requiresApproval: z.boolean(),
});

function readServiceFields(formData: FormData) {
  const optional = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim() !== "" ? v : undefined;
  };
  return serviceFieldsSchema.safeParse({
    name: formData.get("name"),
    description: optional("description"),
    durationMinutes: optional("durationMinutes"),
    priceMajor: optional("priceMajor"),
    priceUnit: optional("priceUnit"),
    capacity: optional("capacity"),
    customerSetsEnd: formData.get("customerSetsEnd") === "on",
    onlineBooking: formData.get("onlineBooking") === "on",
    requiresApproval: formData.get("confirmation") === "manual",
  });
}

const createServiceSchema = z.object({ tenantId: z.uuid(), slug: z.string(), locale: z.string() });

export async function createServiceAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const t = await actionT(formData.get("locale"));
  const ids = createServiceSchema.safeParse({ tenantId: formData.get("tenantId"), slug: formData.get("slug"), locale: formData.get("locale") });
  const fields = readServiceFields(formData);
  if (!ids.success || !fields.success) return fields.success ? t("reload") : t("checkFields");
  const { locale, slug } = ids.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const f = fields.data;
  // A service with no fixed length needs the customer to say how long, or it is open-ended — both allowed.
  const supabase = await createUserClient();
  const { data: currency } = await supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle();
  const { error } = await supabase.from("bookable_services").insert({
    tenant_id: tenant.id,
    name: { [locale]: f.name },
    description: f.description ? { [locale]: f.description } : {},
    duration_minutes: f.durationMinutes ?? null,
    price_minor: f.priceMajor !== undefined ? Math.round(f.priceMajor * 10 ** (currency?.exponent ?? 2)) : null,
    price_unit: f.priceUnit,
    capacity: f.capacity,
    customer_sets_end: f.customerSetsEnd,
    online_booking: f.onlineBooking,
    requires_approval: f.requiresApproval,
  });
  if (error) return t("bookings.serviceCreateFailed");
  translateSoon();

  revalidatePath(`/${locale}/${slug}/bookings`);
}

const setActiveSchema = z.object({
  serviceId: z.uuid(),
  value: z.enum(["true", "false"]),
  locale: z.string(),
  slug: z.string(),
});

export async function setServiceActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    serviceId: formData.get("serviceId"),
    value: formData.get("value"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookable_services")
    .update({ is_active: parsed.data.value === "true" })
    .eq("id", parsed.data.serviceId)
    .is("archived_at", null);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

const serviceIdSchema = z.object({ serviceId: z.uuid(), locale: z.string(), slug: z.string() });

/**
 * Delete a service: it leaves the console and the Agent at once. The row is
 * kept (archived) so its past bookings still show what was booked, and so
 * the Business Brain or a file import never adds it back.
 */
export async function deleteServiceAction(formData: FormData): Promise<void> {
  const parsed = serviceIdSchema.safeParse({
    serviceId: formData.get("serviceId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookable_services")
    .update({ is_active: false, archived_at: new Date().toISOString() })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.serviceId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

const updateServiceSchema = z.object({ serviceId: z.uuid(), locale: z.string(), slug: z.string() });

export type ServiceEditState = { ok: boolean; message: string } | undefined;

/** Edit a service (name and description in the console's language; other translations kept). */
export async function updateServiceAction(_prev: ServiceEditState, formData: FormData): Promise<ServiceEditState> {
  const t = await actionT(formData.get("locale"));
  const ids = updateServiceSchema.safeParse({ serviceId: formData.get("serviceId"), locale: formData.get("locale"), slug: formData.get("slug") });
  const fields = readServiceFields(formData);
  if (!ids.success) return { ok: false, message: t("reload") };
  if (!fields.success) return { ok: false, message: t("checkFields") };
  const { locale, slug } = ids.data;
  const f = fields.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const [{ data: service }, { data: currency }] = await Promise.all([
    supabase
      .from("bookable_services")
      .select("name, description")
      .eq("tenant_id", tenant.id)
      .eq("id", ids.data.serviceId)
      .is("archived_at", null)
      .maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  if (!service) return { ok: false, message: t("bookings.serviceGone") };
  const key = locale in service.name ? locale : (Object.keys(service.name)[0] ?? locale);
  const description = { ...(service.description ?? {}) };
  if (f.description) description[key] = f.description;
  else delete description[key];
  const { error } = await supabase
    .from("bookable_services")
    .update({
      name: { ...service.name, [key]: f.name },
      description,
      duration_minutes: f.durationMinutes ?? null,
      price_minor: f.priceMajor === undefined ? null : Math.round(f.priceMajor * 10 ** (currency?.exponent ?? 2)),
      price_unit: f.priceUnit,
      capacity: f.capacity,
      customer_sets_end: f.customerSetsEnd,
      online_booking: f.onlineBooking,
      requires_approval: f.requiresApproval,
    })
    .eq("tenant_id", tenant.id)
    .eq("id", ids.data.serviceId);
  if (error) return { ok: false, message: t("bookings.serviceNoPermission") };
  translateSoon();
  revalidatePath(`/${locale}/${slug}/bookings`);
  return { ok: true, message: t("saved") };
}

const cancelBookingSchema = z.object({ bookingId: z.uuid(), locale: z.string(), slug: z.string() });

export async function cancelBookingAction(formData: FormData): Promise<void> {
  const parsed = cancelBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", parsed.data.bookingId)
    .eq("status", "confirmed");
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

/** Why `book_service` refused, worded under actions.bookings.refusal.<reason>. */
const refusalKey = (reason: BookingRefusal) => `bookings.refusal.${reason}`;

const consoleBookingSchema = z.object({
  locale: z.string(),
  slug: z.string(),
  serviceId: z.uuid(),
  date: z.iso.date(),
  timeIn: z.string().regex(/^\d{2}:\d{2}$/),
  timeOut: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  durationMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  partySize: z.coerce.number().int().min(1).max(500).default(1),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.email().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  branchId: z.uuid().optional(),
});

export type ConsoleBookingState = { ok: boolean; message: string } | undefined;

/** Bookings → New booking: the owner books a customer in (phone, walk-in). Validated like every booking — hours, capacity. */
export async function createConsoleBookingAction(_prev: ConsoleBookingState, formData: FormData): Promise<ConsoleBookingState> {
  const t = await actionT(formData.get("locale"));
  const optional = (key: string) => {
    const v = formData.get(key);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };
  const parsed = consoleBookingSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    serviceId: formData.get("serviceId"),
    date: formData.get("date"),
    timeIn: formData.get("timeIn"),
    timeOut: optional("timeOut"),
    durationMinutes: optional("durationMinutes"),
    partySize: optional("partySize"),
    name: formData.get("name"),
    phone: formData.get("phone"),
    email: optional("email"),
    notes: optional("notes"),
    branchId: optional("branchId"),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    return { ok: false, message: field === "phone" ? t("bookings.enterPhone") : field === "name" ? t("bookings.enterName") : t("bookings.refusal.invalid") };
  }
  const d = parsed.data;
  const { tenant } = await requireTenantMember(d.locale, d.slug);
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("book_service", {
    p_tenant_id: tenant.id,
    p_service_id: d.serviceId,
    p_date: d.date,
    p_time_in: d.timeIn,
    p_time_out: d.timeOut ?? null,
    p_duration_minutes: d.timeOut ? null : (d.durationMinutes ?? null),
    p_party_size: d.partySize,
    p_customer_name: d.name,
    p_customer_phone: d.phone,
    p_customer_email: d.email ?? null,
    p_notes: d.notes ?? null,
    p_source: "console",
    p_branch_id: d.branchId ?? null,
  });
  if (error) {
    if (error.code === "42501") return { ok: false, message: /own branches/.test(error.message) ? t("bookings.ownBranches") : t("bookings.noPermission") };
    return { ok: false, message: t("bookings.saveFailed") };
  }
  const result = parseBookResult(data);
  if (!result.ok) return { ok: false, message: t(refusalKey(result.reason)) };
  revalidatePath(`/${d.locale}/${d.slug}/bookings`);
  const date = new Date(`${d.date}T00:00:00Z`).toLocaleDateString(d.locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  return { ok: true, message: t("bookings.booked", { name: d.name, date, time: d.timeIn }) };
}

const completeBookingSchema = z.object({ bookingId: z.uuid(), locale: z.string(), slug: z.string() });

/** The customer came: the booking is completed (it stops holding a place). */
export async function completeBookingAction(formData: FormData): Promise<void> {
  const parsed = completeBookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase
    .from("bookings")
    .update({ status: "completed" })
    .eq("tenant_id", tenant.id)
    .eq("id", parsed.data.bookingId)
    .eq("status", "confirmed");
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
}

const decideSchema = z.object({
  bookingId: z.uuid(),
  decision: z.enum(["confirm", "decline"]),
  locale: z.string(),
  slug: z.string(),
});

export type DecideBookingState = { ok: boolean; message: string } | undefined;

/**
 * Bookings → a request from the Agent: Confirm or Decline. The customer's
 * Agent page, waiting on the answer, shows it within seconds.
 */
export async function decideBookingAction(_prev: DecideBookingState, formData: FormData): Promise<DecideBookingState> {
  const t = await actionT(formData.get("locale"));
  const parsed = decideSchema.safeParse({
    bookingId: formData.get("bookingId"),
    decision: formData.get("decision"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("decide_booking", {
    p_tenant_id: tenant.id,
    p_booking_id: parsed.data.bookingId,
    p_decision: parsed.data.decision,
  });
  if (error) return { ok: false, message: error.code === "42501" ? t("bookings.noPermission") : t("bookings.couldntSave") };
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/bookings`);
  if (!data?.ok) {
    return {
      ok: false,
      message: data?.reason === "already_answered" ? t("bookings.alreadyAnswered", { status: data.status ?? "" }) : t("bookings.requestGone"),
    };
  }
  return { ok: true, message: data.status === "confirmed" ? t("bookings.confirmed") : t("bookings.declined") };
}
