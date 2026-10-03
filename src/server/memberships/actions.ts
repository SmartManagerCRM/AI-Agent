"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";
import { actionT, issueMessage } from "@/server/i18n/action-messages";

export type MembershipFormState = { ok: boolean; message: string } | undefined;

const ids = z.object({ locale: z.string(), slug: z.string().min(1) });

function optional(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const planSchema = z
  .object({
    name: z.string().trim().min(1, "@memberships.planName").max(120),
    description: z.string().trim().max(1000).optional(),
    kind: z.enum(["loyalty", "service"]),
    price: z.coerce.number().min(0).max(10_000_000).default(0),
    joiningFee: z.coerce.number().min(0).max(10_000_000).default(0),
    billingPeriod: z.enum(["none", "day", "week", "month", "year"]),
    periodCount: z.coerce.number().int().min(1).max(60).default(1),
    autoRenew: z.boolean(),
    trialDays: z.coerce.number().int().min(0).max(365).default(0),
    graceDays: z.coerce.number().int().min(0).max(90).default(0),
    visitsPerPeriod: z.coerce.number().int().min(1).max(10_000).optional(),
    discountPercent: z.coerce.number().gt(0).max(100).optional(),
    benefits: z.string().trim().max(2000).optional(),
    maxMembers: z.coerce.number().int().min(1).max(1_000_000).optional(),
    serviceIds: z.array(z.uuid()).max(100),
  })
  .refine((p) => p.billingPeriod !== "none" || (p.trialDays === 0 && !p.autoRenew), {
    message: "@memberships.noExpiryRules",
  });

function readPlan(formData: FormData) {
  return planSchema.safeParse({
    name: formData.get("name"),
    description: optional(formData, "description"),
    kind: formData.get("kind"),
    price: optional(formData, "price"),
    joiningFee: optional(formData, "joiningFee"),
    billingPeriod: formData.get("billingPeriod"),
    periodCount: optional(formData, "periodCount"),
    autoRenew: formData.get("autoRenew") === "on",
    trialDays: optional(formData, "trialDays"),
    graceDays: optional(formData, "graceDays"),
    visitsPerPeriod: optional(formData, "visitsPerPeriod"),
    discountPercent: optional(formData, "discountPercent"),
    benefits: optional(formData, "benefits"),
    maxMembers: optional(formData, "maxMembers"),
    serviceIds: formData.getAll("serviceIds").filter((v): v is string => typeof v === "string" && v !== ""),
  });
}

async function exponentOf(supabase: Awaited<ReturnType<typeof createUserClient>>, code: string) {
  const { data } = await supabase.from("currencies").select("exponent").eq("code", code).maybeSingle();
  return data?.exponent ?? 2;
}

/** Memberships → New plan (or Edit, with planId). Prices are in the business's currency. */
export async function savePlanAction(_prev: MembershipFormState, formData: FormData): Promise<MembershipFormState> {
  const t = await actionT(formData.get("locale"));
  const where = ids.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!where.success) return { ok: false, message: t("reload") };
  const parsed = readPlan(formData);
  if (!parsed.success) return { ok: false, message: issueMessage(t, parsed.error.issues, "memberships.checkPlan") };
  const { locale, slug } = where.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const p = parsed.data;
  const planId = optional(formData, "planId");
  const existing = planId
    ? (await supabase.from("membership_plans").select("name, description, currency").eq("tenant_id", tenant.id).eq("id", planId).maybeSingle()).data
    : null;
  if (planId && !existing) return { ok: false, message: t("memberships.planGone") };
  const currency = existing?.currency ?? tenant.currency;
  const exp = await exponentOf(supabase, currency);
  const minor = (major: number) => Math.round(major * 10 ** exp);
  const key = existing && !(locale in existing.name) ? (Object.keys(existing.name)[0] ?? locale) : locale;
  const description = { ...(existing?.description ?? {}) };
  if (p.description) description[key] = p.description;
  else delete description[key];
  const row = {
    name: { ...(existing?.name ?? {}), [key]: p.name },
    description,
    kind: p.kind,
    price_minor: minor(p.price),
    joining_fee_minor: minor(p.joiningFee),
    billing_period: p.billingPeriod,
    period_count: p.billingPeriod === "none" ? 1 : p.periodCount,
    auto_renew_default: p.billingPeriod === "none" ? false : p.autoRenew,
    trial_days: p.billingPeriod === "none" ? 0 : p.trialDays,
    grace_days: p.graceDays,
    visits_per_period: p.visitsPerPeriod ?? null,
    discount_percent: p.discountPercent ?? null,
    benefits: p.benefits ?? null,
    max_members: p.maxMembers ?? null,
    service_ids: p.serviceIds,
  };
  const { error } = planId
    ? await supabase.from("membership_plans").update(row).eq("tenant_id", tenant.id).eq("id", planId)
    : await supabase.from("membership_plans").insert({ ...row, tenant_id: tenant.id, currency });
  if (error) return { ok: false, message: error.code === "42501" ? t("memberships.noPermission") : t("memberships.planSaveFailed") };
  translateSoon();
  revalidatePath(`/${locale}/${slug}/memberships`);
  return { ok: true, message: planId ? t("memberships.planSaved") : t("memberships.planCreated", { name: p.name }) };
}

const planToggleSchema = ids.extend({ planId: z.uuid(), op: z.enum(["activate", "suspend", "delete"]) });

/** Suspend (no new members), activate, or delete (archive: current members keep their membership). */
export async function planStateAction(formData: FormData): Promise<void> {
  const parsed = planToggleSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    planId: formData.get("planId"),
    op: formData.get("op"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const change =
    parsed.data.op === "delete"
      ? { is_active: false, archived_at: new Date().toISOString() }
      : { is_active: parsed.data.op === "activate" };
  let query = supabase.from("membership_plans").update(change).eq("tenant_id", tenant.id).eq("id", parsed.data.planId);
  if (parsed.data.op !== "delete") query = query.is("archived_at", null);
  await query;
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/memberships`);
}

/** Reasons `enrol_membership` gives (actions.memberships.enrol.<reason>). */
const ENROL_REASONS = new Set(["plan", "name", "start_date", "method", "full"]);

const enrolSchema = ids.extend({
  planId: z.uuid(),
  name: z.string().trim().min(1, "@memberships.enrol.name").max(120),
  phone: z.string().trim().max(40).optional(),
  email: z.email("@memberships.validEmail").max(200).optional(),
  startDate: z.iso.date(),
  paid: z.boolean(),
  method: z.enum(["cash", "card", "transfer", "online", "other"]).optional(),
  autoRenew: z.boolean(),
  notes: z.string().trim().max(1000).optional(),
});

/** Memberships → Add member. */
export async function enrolMemberAction(_prev: MembershipFormState, formData: FormData): Promise<MembershipFormState> {
  const t = await actionT(formData.get("locale"));
  const parsed = enrolSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    planId: formData.get("planId"),
    name: formData.get("name"),
    phone: optional(formData, "phone"),
    email: optional(formData, "email"),
    startDate: formData.get("startDate"),
    paid: formData.get("paid") === "on",
    method: optional(formData, "method"),
    autoRenew: formData.get("autoRenew") === "on",
    notes: optional(formData, "notes"),
  });
  if (!parsed.success) return { ok: false, message: issueMessage(t, parsed.error.issues, "memberships.checkMember") };
  const d = parsed.data;
  await requireTenantMember(d.locale, d.slug);
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("enrol_membership", {
    p_plan_id: d.planId,
    p_customer_name: d.name,
    p_customer_phone: d.phone ?? null,
    p_customer_email: d.email ?? null,
    p_start_date: d.startDate,
    p_paid: d.paid,
    p_payment_method: d.paid ? (d.method ?? "cash") : null,
    p_auto_renew: d.autoRenew,
    p_notes: d.notes ?? null,
  });
  if (error) return { ok: false, message: error.code === "42501" ? t("memberships.noPermission") : t("memberships.enrolFailed") };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; member_number?: number };
  if (!r.ok) return { ok: false, message: ENROL_REASONS.has(r.reason ?? "") ? t(`memberships.enrol.${r.reason}`) : t("memberships.enrolFailedShort") };
  revalidatePath(`/${d.locale}/${d.slug}/memberships`);
  return { ok: true, message: t("memberships.enrolled", { name: d.name, number: r.member_number ?? "" }) };
}

/** Reasons the membership RPCs give (actions.memberships.member.<reason>). */
const MEMBER_REASONS = new Set(["not_found", "no_expiry", "cancelled", "paused", "expired", "not_started", "no_visits_left", "not_unpaid", "method", "transition"]);

const memberOpSchema = ids.extend({
  membershipId: z.uuid(),
  op: z.enum(["checkin", "renew", "renew_unpaid", "paid", "pause", "resume", "cancel"]),
  method: z.enum(["cash", "card", "transfer", "online", "other"]).default("cash"),
  reason: z.string().trim().max(500).optional(),
});

/** One member's actions: check in, renew, record payment, freeze, resume, cancel. */
export async function memberOpAction(_prev: MembershipFormState, formData: FormData): Promise<MembershipFormState> {
  const t = await actionT(formData.get("locale"));
  const parsed = memberOpSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    membershipId: formData.get("membershipId"),
    op: formData.get("op"),
    method: optional(formData, "method"),
    reason: optional(formData, "reason"),
  });
  if (!parsed.success) return { ok: false, message: t("reload") };
  const d = parsed.data;
  await requireTenantMember(d.locale, d.slug);
  const supabase = await createUserClient();
  const call =
    d.op === "checkin"
      ? supabase.rpc("membership_check_in", { p_membership_id: d.membershipId })
      : d.op === "renew" || d.op === "renew_unpaid"
        ? supabase.rpc("renew_membership", { p_membership_id: d.membershipId, p_paid: d.op === "renew", p_payment_method: d.op === "renew" ? d.method : null })
        : d.op === "paid"
          ? supabase.rpc("mark_membership_paid", { p_membership_id: d.membershipId, p_payment_method: d.method })
          : supabase.rpc("set_membership_status", {
              p_membership_id: d.membershipId,
              p_status: d.op === "pause" ? "paused" : d.op === "resume" ? "active" : "cancelled",
              p_reason: d.reason ?? null,
            });
  const { data, error } = await call;
  if (error) return { ok: false, message: error.code === "42501" ? t("memberships.noPermission") : t("memberships.opFailed") };
  const r = (data ?? {}) as { ok?: boolean; reason?: string; visits_used?: number; visits_per_period?: number | null; end_date?: string };
  if (!r.ok) return { ok: false, message: MEMBER_REASONS.has(r.reason ?? "") ? t(`memberships.member.${r.reason}`) : t("memberships.opFailedShort") };
  revalidatePath(`/${d.locale}/${d.slug}/memberships`);
  const date = r.end_date ? new Date(`${r.end_date}T00:00:00Z`).toLocaleDateString(d.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
  if (d.op === "checkin") {
    return { ok: true, message: r.visits_per_period ? t("memberships.done.checkinVisits", { used: r.visits_used ?? 0, total: r.visits_per_period }) : t("memberships.done.checkin") };
  }
  return { ok: true, message: t(`memberships.done.${d.op}`, { date }) };
}
