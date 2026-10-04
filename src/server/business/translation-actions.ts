"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { translateSoon } from "@/server/translate/queue";

const schema = z.object({ locale: z.string(), slug: z.string().min(1), words: z.string().max(5000) });

export type KeptWordsState = { ok: boolean; message: string } | undefined;

/**
 * Settings → Translation: words the automatic translation keeps as written
 * (brand and dish names). Saving re-checks the business's texts, so names
 * already translated literally are redone with the words kept.
 */
export async function saveKeptWordsAction(_prev: KeptWordsState, formData: FormData): Promise<KeptWordsState> {
  const t = await actionT(formData.get("locale"));
  const parsed = schema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug"), words: formData.get("words") ?? "" });
  if (!parsed.success) return { ok: false, message: t("checkFields") };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const words = [...new Set(parsed.data.words.split("\n").map((w) => w.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 100);
  const supabase = await createUserClient();
  const { data: current } = await supabase.from("tenant_settings").select("translation").eq("tenant_id", tenant.id).maybeSingle();
  const { data: saved, error } = await supabase
    .from("tenant_settings")
    .update({ translation: { ...(current?.translation ?? {}), keep_words: words } })
    .eq("tenant_id", tenant.id)
    .select("tenant_id");
  if (error || !saved?.length) return { ok: false, message: t("business.keptWordsFailed") };
  await supabase.rpc("queue_tenant_translations", { p_tenant_id: tenant.id });
  translateSoon();
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/settings`);
  return { ok: true, message: t("business.keptWordsSaved", { n: words.length }) };
}
