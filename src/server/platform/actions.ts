"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin actions (spec §98 Phase 9). Most of these are plain
 * RLS-scoped writes, not SECURITY DEFINER functions — `has_permission`'s
 * own `is_super_admin()` bypass already lets a signed-in Super Admin
 * update any tenant, and `ai_model_configs`/`platform_settings` each
 * carry a Super-Admin-only write policy (the latter added this phase).
 * Only managing `platform_admins` itself needs a function, since looking
 * a user up by email requires reading `auth.users`, which no signed-in
 * session — Super Admin included — can do directly.
 */

const settingsSchema = z.object({
  platformName: z.string().trim().min(1).max(120),
  maintenanceMode: z.enum(["on"]).optional(),
  locale: z.string(),
});

export async function updatePlatformSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = settingsSchema.safeParse({
    platformName: formData.get("platformName"),
    maintenanceMode: formData.get("maintenanceMode") ?? undefined,
    locale: formData.get("locale"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({ platform_name: parsed.data.platformName, maintenance_mode: parsed.data.maintenanceMode === "on" })
    .eq("id", true);
  if (error) return "VALIDATION_ERROR: could not save platform settings — please try again.";

  revalidatePath(`/${parsed.data.locale}/super-admin/settings`);
}

const tenantStatusSchema = z.object({
  tenantId: z.uuid(),
  status: z.enum(["active", "suspended", "closed"]),
  locale: z.string(),
});

export async function setTenantStatusAction(formData: FormData): Promise<void> {
  const parsed = tenantStatusSchema.safeParse({
    tenantId: formData.get("tenantId"),
    status: formData.get("status"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase.from("tenants").update({ status: parsed.data.status }).eq("id", parsed.data.tenantId);
  revalidatePath(`/${parsed.data.locale}/super-admin`);
}

const createModelSchema = z.object({
  provider: z.enum(["gemini", "anthropic"]),
  model: z.string().trim().min(1).max(120),
  kind: z.enum(["fast", "agent"]),
  inputPrice: z.coerce.number().min(0),
  outputPrice: z.coerce.number().min(0),
  locale: z.string(),
});

export async function createAiModelConfigAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = createModelSchema.safeParse({
    provider: formData.get("provider"),
    model: formData.get("model"),
    kind: formData.get("kind"),
    inputPrice: formData.get("inputPrice"),
    outputPrice: formData.get("outputPrice"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.from("ai_model_configs").insert({
    provider: parsed.data.provider,
    model: parsed.data.model,
    kind: parsed.data.kind,
    input_price_per_million_usd: parsed.data.inputPrice,
    output_price_per_million_usd: parsed.data.outputPrice,
  });
  if (error) return "VALIDATION_ERROR: could not create that model config — please try again.";

  revalidatePath(`/${parsed.data.locale}/super-admin/models`);
}

const toggleModelSchema = z.object({
  configId: z.uuid(),
  field: z.enum(["is_active", "is_default"]),
  value: z.enum(["true", "false"]),
  locale: z.string(),
});

export async function setAiModelConfigFieldAction(formData: FormData): Promise<void> {
  const parsed = toggleModelSchema.safeParse({
    configId: formData.get("configId"),
    field: formData.get("field"),
    value: formData.get("value"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const value = parsed.data.value === "true";
  const patch = parsed.data.field === "is_active" ? { is_active: value } : { is_default: value };
  await supabase.from("ai_model_configs").update(patch).eq("id", parsed.data.configId);
  revalidatePath(`/${parsed.data.locale}/super-admin/models`);
}

const addAdminSchema = z.object({ email: z.email(), locale: z.string() });

export async function addPlatformAdminAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = addAdminSchema.safeParse({ email: formData.get("email"), locale: formData.get("locale") });
  if (!parsed.success) return "VALIDATION_ERROR: enter a valid email.";

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("add_platform_admin", { p_email: parsed.data.email, p_level: "admin" });
  if (error) return error.message.replace(/^[A-Z_]+: /, "");

  revalidatePath(`/${parsed.data.locale}/super-admin/admins`);
}

const removeAdminSchema = z.object({ userId: z.uuid(), locale: z.string() });

export async function removePlatformAdminAction(formData: FormData): Promise<void> {
  const parsed = removeAdminSchema.safeParse({ userId: formData.get("userId"), locale: formData.get("locale") });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  await supabase.rpc("remove_platform_admin", { p_user_id: parsed.data.userId });
  revalidatePath(`/${parsed.data.locale}/super-admin/admins`);
}
