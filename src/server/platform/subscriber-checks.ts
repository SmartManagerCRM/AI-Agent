"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** A Super Admin opened this subscriber: it no longer counts as "not yet checked". True when it just changed. */
export async function markSubscriberCheckedAction(input: { locale: string; tenantId: string }): Promise<boolean> {
  const parsed = z.object({ locale: z.string(), tenantId: z.uuid() }).safeParse(input);
  if (!parsed.success) return false;
  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { data } = await supabase.rpc("mark_subscribers_checked", { p_tenant_ids: [parsed.data.tenantId] });
  return (data ?? 0) > 0;
}

/** Subscribers → "Mark all as checked". */
export async function markAllSubscribersCheckedAction(formData: FormData): Promise<void> {
  const locale = String(formData.get("locale") ?? "en");
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  await supabase.rpc("mark_subscribers_checked", { p_tenant_ids: null });
  revalidatePath(`/${locale}/super-admin`, "layout");
}
