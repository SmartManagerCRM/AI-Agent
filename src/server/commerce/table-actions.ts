"use server";

import { actionT } from "@/server/i18n/action-messages";
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
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return t("checkFields");

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  const { error } = await supabase.from("branch_tables").insert({
    tenant_id: parsed.data.tenantId,
    branch_id: parsed.data.branchId,
    label: parsed.data.label,
  });
  if (error) {
    return error.code === "23505"
      ? t("checkout.tableExists")
      : t("checkout.tableFailed");
  }

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/tables`);
}
