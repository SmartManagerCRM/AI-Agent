"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin Master Spec, Phase 5 — granular per-permission RBAC. Toggles
 * one (role, permission) grant on/off. Both `roles` and `permissions`
 * themselves stay seed-only (see the migration's own doc comment) — only
 * which of the real permissions a system role has is writable here.
 */
const toggleSchema = z.object({
  roleId: z.uuid(),
  permissionKey: z.string().min(1),
  grant: z.enum(["true", "false"]),
  locale: z.string(),
});

export async function toggleRolePermissionAction(formData: FormData): Promise<void> {
  const parsed = toggleSchema.safeParse({
    roleId: formData.get("roleId"),
    permissionKey: formData.get("permissionKey"),
    grant: formData.get("grant"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();

  if (parsed.data.grant === "true") {
    await supabase
      .from("role_permissions")
      .insert({ role_id: parsed.data.roleId, permission_key: parsed.data.permissionKey });
  } else {
    await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", parsed.data.roleId)
      .eq("permission_key", parsed.data.permissionKey);
  }

  revalidatePath(`/${parsed.data.locale}/super-admin/roles`);
}
