"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const createTableSchema = z.object({
  tenantId: z.uuid(),
  branchId: z.uuid(),
  label: z.string().trim().min(1).max(40),
  locale: z.string(),
  slug: z.string().min(1),
});

/** A real per-branch table (spec §25 dine-in mode) — its QR code is only ever generated for a row that exists here. */
export async function createTableAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createTableSchema.safeParse({
    tenantId: formData.get("tenantId"),
    branchId: formData.get("branchId"),
    label: formData.get("label"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  const { error } = await supabase.from("branch_tables").insert({
    tenant_id: parsed.data.tenantId,
    branch_id: parsed.data.branchId,
    label: parsed.data.label,
  });
  if (error) {
    return error.code === "23505"
      ? "VALIDATION_ERROR: that branch already has a table with this label."
      : "VALIDATION_ERROR: could not create that table — please try again.";
  }

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/tables`);
}

const setActiveSchema = z.object({
  tableId: z.uuid(),
  value: z.enum(["true", "false"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function setTableActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    tableId: formData.get("tableId"),
    value: formData.get("value"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.from("branch_tables").update({ is_active: parsed.data.value === "true" }).eq("id", parsed.data.tableId);

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/tables`);
}
