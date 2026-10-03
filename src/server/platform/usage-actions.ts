"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { actionT, issueMessage } from "@/server/i18n/action-messages";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin: subscription usage limits. Every write goes through a
 * SECURITY DEFINER function that re-checks `is_super_admin()` itself
 * (`set_plan_usage_limits`, `set_subscription_usage_overrides`) or an
 * RLS policy that does (`usage_settings`) — `requireSuperAdmin` here is
 * the page-level gate, not the only one.
 */

/** "" → null (no limit / use the plan default); otherwise a number. */
const optionalNumber = z.preprocess(
  (v) => (v === "" || v === null || v === undefined ? null : v),
  z.coerce.number().nullable(),
);

const planLimitsSchema = z.object({
  planKey: z.string().min(1),
  conversationLimit: optionalNumber.pipe(z.number().int().positive().nullable()),
  aiCostLimitUsd: optionalNumber.pipe(z.number().min(0).max(100000).nullable()),
  gracePeriodHours: z.coerce.number().int().min(0).max(720),
  locale: z.string(),
});

export async function setPlanUsageLimitsAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = planLimitsSchema.safeParse({
    planKey: formData.get("planKey"),
    conversationLimit: formData.get("conversationLimit"),
    aiCostLimitUsd: formData.get("aiCostLimitUsd"),
    gracePeriodHours: formData.get("gracePeriodHours"),
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return `VALIDATION_ERROR: ${issueMessage(t, parsed.error.issues, "checkFields")}`;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase.rpc("set_plan_usage_limits", {
    p_plan_key: parsed.data.planKey,
    p_conversation_limit: parsed.data.conversationLimit,
    p_ai_cost_limit: parsed.data.aiCostLimitUsd,
    p_grace_period_hours: parsed.data.gracePeriodHours,
  });
  if (error) return `VALIDATION_ERROR: ${t("platform.planLimitsFailed")}`;

  revalidatePath(`/${parsed.data.locale}/super-admin/plans`);
  revalidatePath(`/${parsed.data.locale}/super-admin/usage`);
  return t("saved");
}

const overridesSchema = z.object({
  tenantId: z.uuid(),
  slug: z.string(),
  intent: z.enum(["save", "reset"]),
  conversationLimit: optionalNumber.pipe(z.number().int().positive().nullable()),
  aiCostLimitUsd: optionalNumber.pipe(z.number().min(0).max(100000).nullable()),
  locale: z.string(),
});

/** Save Overrides, or Reset to Plan Defaults (both overrides back to NULL). */
export async function setSubscriberUsageOverridesAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = overridesSchema.safeParse({
    tenantId: formData.get("tenantId"),
    slug: formData.get("slug"),
    intent: formData.get("intent"),
    conversationLimit: formData.get("conversationLimit"),
    aiCostLimitUsd: formData.get("aiCostLimitUsd"),
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return `VALIDATION_ERROR: ${issueMessage(t, parsed.error.issues, "checkFields")}`;

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const reset = parsed.data.intent === "reset";
  const { error } = await supabase.rpc("set_subscription_usage_overrides", {
    p_tenant_id: parsed.data.tenantId,
    p_conversation_limit: reset ? null : parsed.data.conversationLimit,
    p_ai_cost_limit: reset ? null : parsed.data.aiCostLimitUsd,
  });
  if (error) return `VALIDATION_ERROR: ${t("platform.overridesFailed")}`;

  revalidatePath(`/${parsed.data.locale}/super-admin/businesses/${parsed.data.slug}`);
  revalidatePath(`/${parsed.data.locale}/super-admin/subscribers/${parsed.data.slug}`);
  revalidatePath(`/${parsed.data.locale}/super-admin/usage`);
  return reset ? "Reset to plan defaults." : "Overrides saved.";
}

const settingsSchema = z.object({
  conversationWarningPercents: z.string().trim().min(1),
  aiCostWarningPercent: z.coerce.number().int().min(1).max(100),
  trialConversationLimit: optionalNumber.pipe(z.number().int().positive().nullable()),
  trialAiCostLimitUsd: optionalNumber.pipe(z.number().min(0).max(1000).nullable()),
  locale: z.string(),
});

export async function updateUsageSettingsAction(
  _prev: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = settingsSchema.safeParse({
    conversationWarningPercents: formData.get("conversationWarningPercents"),
    aiCostWarningPercent: formData.get("aiCostWarningPercent"),
    trialConversationLimit: formData.get("trialConversationLimit"),
    trialAiCostLimitUsd: formData.get("trialAiCostLimitUsd"),
    locale: formData.get("locale"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return `VALIDATION_ERROR: ${issueMessage(t, parsed.error.issues, "checkFields")}`;
  const percents = [...new Set(parsed.data.conversationWarningPercents.split(",").map((s) => Number(s.trim())))].sort(
    (a, b) => a - b,
  );
  if (
    percents.length === 0 ||
    percents.length > 5 ||
    percents.some((p) => !Number.isInteger(p) || p <= 0 || p >= 100)
  ) {
    return `VALIDATION_ERROR: ${t("platform.warningLevels")}`;
  }

  await requireSuperAdmin(parsed.data.locale);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("usage_settings")
    .update({
      conversation_warning_percents: percents,
      ai_cost_warning_percent: parsed.data.aiCostWarningPercent,
      // Empty = no such trial limit (the trial then ends on its date or the other limit).
      trial_conversation_limit: parsed.data.trialConversationLimit,
      trial_ai_cost_limit_usd: parsed.data.trialAiCostLimitUsd,
    })
    .eq("id", true);
  if (error) return `VALIDATION_ERROR: ${t("platform.thresholdsFailed")}`;

  revalidatePath(`/${parsed.data.locale}/super-admin/usage`);
  return t("saved");
}
