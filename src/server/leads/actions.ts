"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const setStatusSchema = z.object({
  leadId: z.uuid(),
  status: z.enum(["new", "contacted", "qualified", "closed"]),
  locale: z.string(),
  slug: z.string(),
});

export async function setLeadStatusAction(formData: FormData): Promise<void> {
  const parsed = setStatusSchema.safeParse({
    leadId: formData.get("leadId"),
    status: formData.get("status"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.from("leads").update({ status: parsed.data.status }).eq("id", parsed.data.leadId);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/leads`);
}
