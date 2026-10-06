"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const schema = z.object({ locale: z.string(), slug: z.string().min(1), mode: z.enum(["manual", "auto"]) });

export type ReceiptSettingsState = { ok: boolean; message: string } | undefined;

/**
 * Settings → Receipts: print each receipt on a click (manual), or as soon as
 * its order is confirmed (auto). settings.write, checked by the database.
 */
export async function saveReceiptSettingsAction(_prev: ReceiptSettingsState, formData: FormData): Promise<ReceiptSettingsState> {
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug"), mode: formData.get("mode") });
  if (!parsed.success) return { ok: false, message: t("checkFields") };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { data: saved, error } = await supabase
    .from("tenant_settings")
    .update({ receipt_print_mode: parsed.data.mode })
    .eq("tenant_id", tenant.id)
    .select("tenant_id");
  if (error || !saved?.length) return { ok: false, message: t("business.receiptSettingsFailed") };
  // The console's layout reads the mode too (automatic printing).
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}`, "layout");
  return { ok: true, message: t("business.receiptSettingsSaved") };
}
