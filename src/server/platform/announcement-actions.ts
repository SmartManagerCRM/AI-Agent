"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";
import { isContentLang } from "@/server/translate/types";

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
    .insert({
      message: parsed.data.message,
      // The language it was written in — the others are filled in automatically.
      message_locale: isContentLang(parsed.data.locale) ? parsed.data.locale : "en",
      severity: parsed.data.severity,
      created_by: user.id,
    });
  if (error) return t("platform.announcementFailed");
  translateSoon();

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

const updateSchema = z.object({
  id: z.uuid(),
  message: z.string().trim().min(1).max(500),
  severity: z.enum(["info", "warning"]),
  active: z.enum(["on"]).optional(),
  locale: z.string(),
});

/**
 * Edit an announcement in the console's language. In the language it was
 * written in, that is the message itself — its automatic translations are
 * redone. In another language, it is that language's wording (kept as
 * written, never overwritten by a translation).
 */
export async function updateAnnouncementAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = updateSchema.safeParse({
    id: formData.get("id"),
    message: formData.get("message"),
    severity: formData.get("severity"),
    active: formData.get("active") ?? undefined,
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { data: current } = await supabase
    .from("platform_announcements")
    .select("message_locale, message_translations")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!current) return t("platform.announcementFailed");

  const lang = isContentLang(parsed.data.locale) ? parsed.data.locale : current.message_locale;
  const own = lang === current.message_locale;
  const translations = { ...((current.message_translations ?? {}) as Record<string, string>) };
  if (!own) translations[lang] = parsed.data.message;
  const { error } = await supabase
    .from("platform_announcements")
    .update({
      ...(own ? { message: parsed.data.message } : { message_translations: translations }),
      severity: parsed.data.severity,
      is_active: parsed.data.active === "on",
    })
    .eq("id", parsed.data.id);
  if (error) return t("platform.announcementFailed");
  translateSoon();

  revalidatePath(`/${parsed.data.locale}/super-admin/announcements`);
}

const deleteSchema = z.object({ id: z.uuid(), locale: z.string() });

/** Delete an announcement (and, in the database, its automatic translations). */
export async function deleteAnnouncementAction(formData: FormData): Promise<void> {
  const parsed = deleteSchema.safeParse({ id: formData.get("id"), locale: formData.get("locale") });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase.from("platform_announcements").delete().eq("id", parsed.data.id);
  revalidatePath(`/${parsed.data.locale}/super-admin/announcements`);
}
