"use server";

import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { currentUser, requireTenantMember } from "@/server/tenant/context";

const schema = z.object({ locale: z.string(), slug: z.string().min(1) });

/** The person opened Conversations: from now on the bell counts only what is new after this moment. */
export async function markInboxSeenAction(input: { locale: string; slug: string }): Promise<void> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return;
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const user = await currentUser();
  if (!user) return;
  const supabase = await createUserClient();
  // RLS: a person moves only their own marker, for a business they belong to.
  await supabase
    .from("inbox_reads")
    .upsert({ user_id: user.id, tenant_id: tenant.id, seen_at: new Date().toISOString() }, { onConflict: "user_id,tenant_id" });
}
