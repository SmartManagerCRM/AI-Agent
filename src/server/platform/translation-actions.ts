"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";

const schema = z.object({ locale: z.string() });

/** Super Admin: fill in every missing language of every business's and the platform's texts, in the background. */
export async function translateMissingAction(_prev: string | undefined, formData: FormData): Promise<string | undefined> {
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale") });
  if (!parsed.success) return t("reload");
  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("queue_all_translations");
  if (error) return t("platform.translateFailed");
  translateSoon();
  revalidatePath(`/${parsed.data.locale}/super-admin/settings`);
  return t("platform.translateQueued", { n: data ?? 0 });
}
