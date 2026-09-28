"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin, requireUser } from "@/server/tenant/context";

/**
 * Super Admin Master Spec, Phase 4 — secure impersonation / tenant-console
 * access. Both actions are thin wrappers over the two SECURITY DEFINER
 * functions added in 20260928030000_super_admin_impersonation.sql — all of
 * the actual gating (is-this-caller-really-a-Super-Admin, one grant at a
 * time, the audit_logs row) lives in Postgres, not here, since a client
 * can never be trusted to enforce its own privilege check.
 */

const startSchema = z.object({ tenantId: z.uuid(), slug: z.string(), locale: z.string() });

export async function startImpersonationAction(formData: FormData): Promise<void> {
  const parsed = startSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("start_tenant_impersonation", { p_tenant_id: parsed.data.tenantId });
  if (error) redirect(`/${parsed.data.locale}/super-admin/businesses/${parsed.data.slug}`);

  redirect(`/${parsed.data.locale}/${parsed.data.slug}`);
}

const endSchema = z.object({ locale: z.string(), slug: z.string().optional() });

export async function endImpersonationAction(formData: FormData): Promise<void> {
  const parsed = endSchema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") ?? undefined });
  if (!parsed.success) return;

  await requireUser(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase.rpc("end_tenant_impersonation");

  redirect(
    parsed.data.slug
      ? `/${parsed.data.locale}/super-admin/businesses/${parsed.data.slug}`
      : `/${parsed.data.locale}/super-admin`,
  );
}
