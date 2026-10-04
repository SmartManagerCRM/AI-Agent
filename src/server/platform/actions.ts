"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { DISPLAY_CURRENCY_COOKIE } from "@/server/platform/display-currency";

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
  defaultAiMonthlyBudgetUsd: z.coerce.number().min(0).optional(),
  supportedLanguages: z.string().trim().min(1),
  supportedCurrencies: z.string().trim().min(1),
  locale: z.string(),
});

function parseCsvList(raw: string, transform: (s: string) => string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((s) => transform(s.trim()))
        .filter(Boolean),
    ),
  ];
}

export async function updatePlatformSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const rawBudget = formData.get("defaultAiMonthlyBudgetUsd");
  const parsed = settingsSchema.safeParse({
    platformName: formData.get("platformName"),
    maintenanceMode: formData.get("maintenanceMode") ?? undefined,
    defaultAiMonthlyBudgetUsd: rawBudget ? rawBudget : undefined,
    supportedLanguages: formData.get("supportedLanguages"),
    supportedCurrencies: formData.get("supportedCurrencies"),
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      platform_name: parsed.data.platformName,
      maintenance_mode: parsed.data.maintenanceMode === "on",
      supported_languages: parseCsvList(parsed.data.supportedLanguages, (s) => s.toLowerCase()),
      supported_currencies: parseCsvList(parsed.data.supportedCurrencies, (s) => s.toUpperCase()),
    })
    .eq("id", true);
  if (error) return t("platform.settingsFailed");
  // The AI budget column is hidden from signed-in users (column grants) — written with the service role, Super Admin checked above.
  const { error: budgetError } = await serviceClient()
    .from("platform_settings")
    .update({ default_ai_monthly_budget_usd: parsed.data.defaultAiMonthlyBudgetUsd ?? null })
    .eq("id", true);
  if (budgetError) return t("platform.budgetFailed");

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

const setTenantAiBudgetSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  budgetUsd: z.coerce.number().min(0).optional(),
  locale: z.string(),
});

/**
 * AI Cost Guard per-tenant override (spec §98). Deliberately no tenant-
 * facing form ever writes `tenant_settings.ai_monthly_budget_usd` — this
 * is the only place that does, same posture as `tenants.status` above
 * (RLS permits any settings.write holder, but only Super Admin's own UI
 * ever exposes it, since the platform — not the tenant — pays for AI
 * usage).
 */
export async function setTenantAiBudgetAction(formData: FormData): Promise<void> {
  const rawBudget = formData.get("budgetUsd");
  const parsed = setTenantAiBudgetSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
    budgetUsd: rawBudget ? rawBudget : undefined,
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  // Hidden from signed-in users by column grants — service role, after the Super Admin check above.
  await serviceClient()
    .from("tenant_settings")
    .update({ ai_monthly_budget_usd: parsed.data.budgetUsd ?? null })
    .eq("tenant_id", parsed.data.tenantId);
  revalidatePath(`/${parsed.data.locale}/super-admin/businesses/${parsed.data.slug}`);
}

const setTenantAgentActiveSchema = z.object({
  tenantId: z.uuid(),
  active: z.enum(["true", "false"]),
  locale: z.string(),
});

/**
 * Support/safety switch (spec §98 "AI Agents management") — lets Super
 * Admin disable a specific business's Agent platform-wide (e.g. abuse,
 * a runaway cost, an active incident) without needing that business's
 * own credentials. Merges into the existing `agent` jsonb rather than
 * overwriting it, so a business's own assistant_name/greeting/tone
 * survive the toggle.
 */
export async function setTenantAgentActiveAction(formData: FormData): Promise<void> {
  const parsed = setTenantAgentActiveSchema.safeParse({
    tenantId: formData.get("tenantId"),
    active: formData.get("active"),
    locale: formData.get("locale"),
  });
  if (!parsed.success) return;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { data: current } = await supabase
    .from("tenant_settings")
    .select("agent")
    .eq("tenant_id", parsed.data.tenantId)
    .maybeSingle();
  await supabase
    .from("tenant_settings")
    .update({
      agent: {
        active: parsed.data.active === "true",
        assistant_name: current?.agent.assistant_name ?? null,
        greeting: current?.agent.greeting ?? null,
        greetings: current?.agent.greetings ?? null,
        tone: current?.agent.tone ?? null,
        background_path: current?.agent.background_path ?? null,
        voice: current?.agent.voice ?? null,
      },
    })
    .eq("tenant_id", parsed.data.tenantId);
  revalidatePath(`/${parsed.data.locale}/super-admin/ai-agents`);
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
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return issueMessage(t, parsed.error.issues, "checkFields");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.from("ai_model_configs").insert({
    provider: parsed.data.provider,
    model: parsed.data.model,
    kind: parsed.data.kind,
    input_price_per_million_usd: parsed.data.inputPrice,
    output_price_per_million_usd: parsed.data.outputPrice,
  });
  if (error) return t("platform.modelFailed");

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
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return t("platform.validEmail");

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("add_platform_admin", { p_email: parsed.data.email, p_level: "admin" });
  if (error) {
    if (/^NOT_FOUND: no account exists for /.test(error.message)) return t("platform.noAccount", { email: parsed.data.email });
    return t("platform.adminFailed");
  }

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

/** Super Admin header currency bar: which currency amounts are shown in (this viewer only). */
export async function setDisplayCurrencyAction(code: string | null, locale: string): Promise<void> {
  await requireSuperAdmin(locale);
  const store = await cookies();
  if (code && /^[A-Z]{3}$/.test(code)) {
    store.set(DISPLAY_CURRENCY_COOKIE, code, { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", httpOnly: true, maxAge: 60 * 60 * 24 * 365 });
  } else {
    store.delete(DISPLAY_CURRENCY_COOKIE);
  }
}
