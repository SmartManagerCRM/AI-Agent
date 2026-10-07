"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { ManageResult } from "@/components/console/managed-item";
import { actionT } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";

/**
 * Edit / suspend-activate / delete for what a business adds (categories,
 * branches, customers, orders, tables, coupons, leads, bookings, members,
 * staff). Each one checks membership here; the database's row security (or
 * its own function) checks the permission to change that kind of item, and a
 * change it refuses comes back as "no permission".
 */

type T = Awaited<ReturnType<typeof actionT>>;
const base = z.object({ locale: z.string(), slug: z.string().min(1), id: z.uuid() });
const text = (max: number) => z.string().trim().max(max);

async function context(formData: FormData) {
  const t = await actionT(formData.get("locale"));
  const parsed = base.safeParse({ locale: formData.get("locale"), slug: formData.get("slug"), id: formData.get("id") });
  if (!parsed.success) return { t, error: { ok: false as const, message: t("reload") } } as const;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  return { t, tenant, supabase, ...parsed.data, error: null } as const;
}

const field = (formData: FormData, name: string) => String(formData.get(name) ?? "");
const done = (locale: string, slug: string, page: string): ManageResult => {
  revalidatePath(`/${locale}/${slug}/${page}`);
  return { ok: true };
};
/** No row changed: the database's row security refused it (or the item is gone). */
const noRows = (t: T): ManageResult => ({ ok: false, message: t("manage.noPermission") });
/** A localized name: the console's language, or the language it is shown in when that is missing. */
const shownKey = (name: Record<string, string>, locale: string) => (locale in name ? locale : (Object.keys(name)[0] ?? locale));

// ── Categories ───────────────────────────────────────────────────────────
export async function updateCategoryAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const name = text(120).min(1).safeParse(field(formData, "name"));
  if (!name.success) return { ok: false, message: c.t("checkFields") };
  const { data: row } = await c.supabase.from("categories").select("name").eq("tenant_id", c.tenant.id).eq("id", c.id).maybeSingle();
  if (!row) return noRows(c.t);
  const { data } = await c.supabase
    .from("categories")
    .update({ name: { ...row.name, [shownKey(row.name, c.locale)]: name.data } })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  if (!data?.length) return noRows(c.t);
  translateSoon();
  return done(c.locale, c.slug, "products");
}

export async function setCategoryActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase
    .from("categories")
    .update({ is_active: field(formData, "value") === "true" })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "products") : noRows(c.t);
}

/** Its products stay, without a category. */
export async function deleteCategoryAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("categories").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "products") : noRows(c.t);
}

// ── Branches ─────────────────────────────────────────────────────────────
export async function updateBranchAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const f = z
    .object({ name: text(120).min(1), address: text(300), phone: text(40) })
    .safeParse({ name: field(formData, "name"), address: field(formData, "address"), phone: field(formData, "phone") });
  if (!f.success) return { ok: false, message: c.t("checkFields") };
  const { data: row } = await c.supabase.from("branches").select("name, address").eq("tenant_id", c.tenant.id).eq("id", c.id).maybeSingle();
  if (!row) return noRows(c.t);
  const address = (row.address ?? {}) as Record<string, string>;
  const { data } = await c.supabase
    .from("branches")
    .update({
      name: { ...row.name, [shownKey(row.name, c.locale)]: f.data.name },
      address: f.data.address ? { ...address, [shownKey(address, c.locale)]: f.data.address } : {},
      phone: f.data.phone || null,
    })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "branches") : noRows(c.t);
}

export async function setBranchActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const active = field(formData, "value") === "true";
  const { data: row } = await c.supabase.from("branches").select("is_default").eq("tenant_id", c.tenant.id).eq("id", c.id).maybeSingle();
  if (!row) return noRows(c.t);
  if (!active && row.is_default) return { ok: false, message: c.t("manage.defaultBranch") };
  const { data, error } = await c.supabase.from("branches").update({ is_active: active }).eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  if (error?.message?.includes("BRANCH_LIMIT")) return { ok: false, message: c.t("catalog.branchLimit") };
  return data?.length ? done(c.locale, c.slug, "branches") : noRows(c.t);
}

/** Whether the branch takes delivery orders (customers choosing delivery see only those). */
export async function setBranchDeliveryAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const delivers = field(formData, "value") === "true";
  const { data } = await c.supabase
    .from("branches")
    .update({ offers_delivery: delivers })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "branches") : noRows(c.t);
}

export async function setDefaultBranchAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data: row } = await c.supabase.from("branches").select("is_active").eq("tenant_id", c.tenant.id).eq("id", c.id).maybeSingle();
  if (!row) return noRows(c.t);
  if (!row.is_active) return { ok: false, message: c.t("manage.activateFirst") };
  await c.supabase.from("branches").update({ is_default: false }).eq("tenant_id", c.tenant.id).eq("is_default", true);
  const { data } = await c.supabase.from("branches").update({ is_default: true }).eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "branches") : noRows(c.t);
}

/** Refused for the main branch, and for a branch with orders (suspend it instead). */
export async function deleteBranchAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data: row } = await c.supabase.from("branches").select("is_default").eq("tenant_id", c.tenant.id).eq("id", c.id).maybeSingle();
  if (!row) return noRows(c.t);
  if (row.is_default) return { ok: false, message: c.t("manage.defaultBranch") };
  const { data, error } = await c.supabase.from("branches").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  if (error?.code === "23503") return { ok: false, message: c.t("manage.branchHasOrders") };
  return data?.length ? done(c.locale, c.slug, "branches") : noRows(c.t);
}

// ── Customers (edit / delete already in customers/actions.ts) ───────────
export async function setCustomerActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase
    .from("customers")
    .update({ is_active: field(formData, "value") === "true" })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "customers") : noRows(c.t);
}

// ── Orders: customer details only (never lines or totals) ───────────────
const DB_MESSAGES: [RegExp, string][] = [
  [/a paid order cannot be deleted/, "manage.paidOrder"],
  [/too long/, "checkFields"],
  [/needs a delivery address/, "manage.deliveryAddress"],
  [/PERMISSION_ERROR/, "manage.noPermission"],
  [/the business owner cannot be removed/, "manage.owner"],
];
const dbMessage = (t: T, message: string | undefined) => t(DB_MESSAGES.find(([re]) => re.test(message ?? ""))?.[1] ?? "manage.failed");

export async function updateOrderDetailsAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const email = field(formData, "email").trim();
  if (email && !z.email().safeParse(email).success) return { ok: false, message: c.t("manage.email") };
  const { error } = await c.supabase.rpc("update_order_details", {
    p_order_id: c.id,
    p_customer_name: field(formData, "name"),
    p_customer_phone: field(formData, "phone"),
    p_customer_email: email,
    p_delivery_address: field(formData, "address"),
    p_notes: field(formData, "notes"),
  });
  return error ? { ok: false, message: dbMessage(c.t, error.message) } : done(c.locale, c.slug, "orders");
}

export async function deleteOrderAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { error } = await c.supabase.rpc("delete_order", { p_order_id: c.id });
  if (error) return { ok: false, message: dbMessage(c.t, error.message) };
  revalidatePath(`/${c.locale}/${c.slug}`, "layout");
  return { ok: true };
}

// ── Tables ───────────────────────────────────────────────────────────────
export async function updateTableAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const label = text(40).min(1).safeParse(field(formData, "label"));
  if (!label.success) return { ok: false, message: c.t("checkFields") };
  const { data, error } = await c.supabase.from("branch_tables").update({ label: label.data }).eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  if (error?.code === "23505") return { ok: false, message: c.t("checkout.tableExists") };
  return data?.length ? done(c.locale, c.slug, "tables") : noRows(c.t);
}

export async function setTableActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase
    .from("branch_tables")
    .update({ is_active: field(formData, "value") === "true" })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "tables") : noRows(c.t);
}

export async function deleteTableAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("branch_tables").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "tables") : noRows(c.t);
}

// ── Coupons (the discount itself is only ever applied by the database) ──
export async function updateCouponAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const f = z
    .object({
      description: text(200),
      discountType: z.enum(["percentage", "fixed"]),
      discountValue: z.coerce.number().positive(),
      currencyExponent: z.coerce.number().int().min(0).max(3),
      minOrderMajor: z.coerce.number().min(0).optional(),
      usageLimit: z.coerce.number().int().positive().optional(),
      startsAt: z.string(),
      endsAt: z.string(),
    })
    .safeParse({
      description: field(formData, "description"),
      discountType: formData.get("discountType"),
      discountValue: formData.get("discountValue"),
      currencyExponent: formData.get("currencyExponent"),
      minOrderMajor: formData.get("minOrderMajor") || undefined,
      usageLimit: formData.get("usageLimit") || undefined,
      startsAt: field(formData, "startsAt"),
      endsAt: field(formData, "endsAt"),
    });
  if (!f.success) return { ok: false, message: c.t("checkFields") };
  const value = f.data.discountType === "percentage" ? Math.round(f.data.discountValue * 100) : Math.round(f.data.discountValue * 10 ** f.data.currencyExponent);
  if (f.data.discountType === "percentage" && value > 10000) return { ok: false, message: c.t("marketing.over100") };
  const { data } = await c.supabase
    .from("coupons")
    .update({
      description: f.data.description || null,
      discount_type: f.data.discountType,
      discount_value: value,
      min_order_minor: Math.round((f.data.minOrderMajor ?? 0) * 10 ** f.data.currencyExponent),
      usage_limit: f.data.usageLimit ?? null,
      starts_at: f.data.startsAt || null,
      ends_at: f.data.endsAt || null,
    })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "marketing") : noRows(c.t);
}

export async function setCouponActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase
    .from("coupons")
    .update({ status: field(formData, "value") === "true" ? "active" : "disabled" })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "marketing") : noRows(c.t);
}

/** Orders that used it keep their discount (they just no longer link to the coupon). */
export async function deleteCouponAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("coupons").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "marketing") : noRows(c.t);
}

// ── Leads, bookings, members: contact details ───────────────────────────
/** A member must have a name; a lead or booking may not (the chat may not have asked); a lead keeps its message. */
const contact = (formData: FormData, need: { name?: boolean; notes?: boolean; notesMax?: number } = {}) =>
  z
    .object({
      name: need.name ? text(120).min(1) : text(120),
      phone: text(40),
      email: z.union([z.literal(""), z.email().max(200)]),
      notes: need.notes ? text(need.notesMax ?? 1000).min(1) : text(need.notesMax ?? 1000),
    })
    .safeParse({
      name: field(formData, "name"),
      phone: field(formData, "phone"),
      email: field(formData, "email").trim(),
      notes: field(formData, "notes"),
    });

export async function updateLeadAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const f = contact(formData, { notes: true, notesMax: 2000 });
  if (!f.success) return { ok: false, message: c.t("checkFields") };
  const { data } = await c.supabase
    .from("leads")
    .update({ customer_name: f.data.name || null, customer_phone: f.data.phone || null, customer_email: f.data.email || null, message: f.data.notes })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "leads") : noRows(c.t);
}

export async function deleteLeadAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("leads").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "leads") : noRows(c.t);
}

export async function updateBookingDetailsAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const f = contact(formData);
  if (!f.success) return { ok: false, message: c.t("checkFields") };
  const { data } = await c.supabase
    .from("bookings")
    .update({ customer_name: f.data.name || null, customer_phone: f.data.phone || null, customer_email: f.data.email || null, notes: f.data.notes || null })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "bookings") : noRows(c.t);
}

export async function deleteBookingAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("bookings").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  if (!data?.length) return noRows(c.t);
  revalidatePath(`/${c.locale}/${c.slug}`, "layout");
  return { ok: true };
}

export async function updateMemberDetailsAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const f = contact(formData, { name: true });
  if (!f.success) return { ok: false, message: c.t("checkFields") };
  const { data } = await c.supabase
    .from("memberships")
    .update({ customer_name: f.data.name, customer_phone: f.data.phone || null, customer_email: f.data.email || null, notes: f.data.notes || null })
    .eq("tenant_id", c.tenant.id)
    .eq("id", c.id)
    .select("id");
  return data?.length ? done(c.locale, c.slug, "memberships") : noRows(c.t);
}

/** Its visits and payments go with it. */
export async function deleteMemberAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { data } = await c.supabase.from("memberships").delete().eq("tenant_id", c.tenant.id).eq("id", c.id).select("id");
  return data?.length ? done(c.locale, c.slug, "memberships") : noRows(c.t);
}

// ── Staff ────────────────────────────────────────────────────────────────
export async function removeStaffMemberAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { error } = await c.supabase.rpc("remove_staff_member", { p_member_id: c.id });
  return error ? { ok: false, message: dbMessage(c.t, error.message) } : done(c.locale, c.slug, "staff");
}

/** Suspend / reactivate a staff member (the database refuses it for the owner). */
export async function setStaffActiveAction(_prev: ManageResult, formData: FormData): Promise<ManageResult> {
  const c = await context(formData);
  if (c.error) return c.error;
  const { error } = await c.supabase.rpc("set_staff_member_status", {
    p_member_id: c.id,
    p_status: field(formData, "value") === "true" ? "active" : "disabled",
  });
  if (error) return { ok: false, message: /owner/.test(error.message) ? c.t("manage.owner") : dbMessage(c.t, error.message) };
  return done(c.locale, c.slug, "staff");
}
