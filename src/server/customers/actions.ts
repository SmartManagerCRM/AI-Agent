"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export type CustomerFormState = { ok: boolean; message: string } | undefined;

function optional(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

const customerSchema = z
  .object({
    locale: z.string(),
    slug: z.string().min(1),
    customerId: z.uuid().optional(),
    name: z.string().trim().min(1, "Enter the customer's name.").max(120),
    phone: z.string().trim().max(40).optional(),
    email: z.email("That email doesn't look right.").max(200).optional(),
    birthday: z.iso.date("Check the birthday.").optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((c) => !c.phone || /\d{4,}/.test(c.phone.replace(/\D/g, "")), { message: "Check the phone number." });

/**
 * Customers → Add customer (or Edit, with customerId). Saved under the
 * member's own session, so RLS decides: only people allowed to manage this
 * business's customers can, and only for this business.
 */
export async function saveCustomerAction(_prev: CustomerFormState, formData: FormData): Promise<CustomerFormState> {
  const parsed = customerSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    customerId: optional(formData, "customerId"),
    name: formData.get("name") ?? "",
    phone: optional(formData, "phone"),
    email: optional(formData, "email")?.toLowerCase(),
    birthday: optional(formData, "birthday"),
    notes: optional(formData, "notes"),
  });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the customer's details." };
  const { locale, slug, customerId, ...c } = parsed.data;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const row = { name: c.name, phone: c.phone ?? null, email: c.email ?? null, birthday: c.birthday ?? null, notes: c.notes ?? null };
  const { data, error } = customerId
    ? await supabase.from("customers").update(row).eq("tenant_id", tenant.id).eq("id", customerId).select("id")
    : await supabase.from("customers").insert({ ...row, tenant_id: tenant.id }).select("id");
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        message: error.message.includes("email")
          ? "A customer with this email is already saved — search for them instead."
          : "A customer with this phone number is already saved — search for them instead.",
      };
    }
    return { ok: false, message: error.code === "42501" ? "You need permission to manage customers." : "Couldn't save the customer — please try again." };
  }
  if (customerId && (data ?? []).length === 0) return { ok: false, message: "You need permission to manage customers." };
  revalidatePath(`/${locale}/${slug}/customers`);
  return { ok: true, message: customerId ? "Customer saved." : `${c.name} added to your customers.` };
}

const deleteSchema = z.object({ locale: z.string(), slug: z.string().min(1), customerId: z.uuid() });

/** Removes a saved customer. Their orders stay, listed by the details on the orders. */
export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse({
    locale: formData.get("locale"),
    slug: formData.get("slug"),
    customerId: formData.get("customerId"),
  });
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.from("customers").delete().eq("tenant_id", tenant.id).eq("id", parsed.data.customerId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/customers`);
}
