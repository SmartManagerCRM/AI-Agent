"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const createSchema = z.object({
  message: z.string().trim().min(1).max(500),
  severity: z.enum(["info", "warning"]),
  locale: z.string(),
});

export async function createAnnouncementAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createSchema.safeParse({
    message: formData.get("message"),
    severity: formData.get("severity"),
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  const user = await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("platform_announcements")
    .insert({ message: parsed.data.message, severity: parsed.data.severity, created_by: user.id });
  if (error) return t("platform.announcementFailed");

  revalidatePath(`/${parsed.data.locale}/super-admin/announcements`);
}

const setActiveSchema = z.object({ id: z.uuid(), value: z.enum(["true", "false"]), locale: z.string() });

export async function setAnnouncementActiveAction(formData: FormData): Promise<void> {
  const parsed = setActiveSchema.safeParse({
    id: formData.get("id"),
    value: formData.get("value"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase
    .from("platform_announcements")
    .update({ is_active: parsed.data.value === "true" })
    .eq("id", parsed.data.id);
  revalidatePath(`/${parsed.data.locale}/super-admin/announcements`);
}
