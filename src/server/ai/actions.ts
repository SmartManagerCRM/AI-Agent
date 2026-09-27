"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { runAgentGateway, type GatewayResult } from "@/server/ai/gateway";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const updateSettingsSchema = z.object({
  tenantId: z.uuid(),
  assistantName: z.string().trim().max(80).optional().or(z.literal("")),
  greeting: z.string().trim().max(300).optional().or(z.literal("")),
  tone: z.enum(["friendly", "formal", "playful"]),
  active: z.enum(["on"]).optional(),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function updateAgentSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = updateSettingsSchema.safeParse({
    tenantId: formData.get("tenantId"),
    assistantName: formData.get("assistantName"),
    greeting: formData.get("greeting"),
    tone: formData.get("tone"),
    active: formData.get("active") ?? undefined,
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { error } = await supabase
    .from("tenant_settings")
    .update({
      agent: {
        active: parsed.data.active === "on",
        assistant_name: parsed.data.assistantName || null,
        greeting: parsed.data.greeting || null,
        tone: parsed.data.tone,
      },
    })
    .eq("tenant_id", parsed.data.tenantId);
  if (error) return `VALIDATION_ERROR: ${error.message}`;

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/agent`);
}

const testMessageSchema = z.object({
  tenantId: z.uuid(),
  currency: z.string().length(3),
  slug: z.string().min(1),
  locale: z.string(),
  message: z.string().trim().min(1).max(1000),
});

export type TestAgentState = { message: string; result: GatewayResult } | { message: string; error: string } | undefined;

/**
 * Runs one message through the Agent Gateway from the console — the
 * "clearly marked test environment" the spec asks for (§73), and today's
 * only way to exercise the deterministic-first router end to end before
 * Phase 4/10 build a real customer-facing surface. No cart/order/payment
 * exists yet for a test message to accidentally trigger.
 */
export async function testAgentMessageAction(_prevState: TestAgentState, formData: FormData): Promise<TestAgentState> {
  const parsed = testMessageSchema.safeParse({
    tenantId: formData.get("tenantId"),
    currency: formData.get("currency"),
    slug: formData.get("slug"),
    locale: formData.get("locale"),
    message: formData.get("message"),
  });
  if (!parsed.success) return { message: "", error: "Enter a message to test." };

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  const result = await runAgentGateway(supabase, {
    tenant: { id: parsed.data.tenantId, currency: parsed.data.currency, slug: parsed.data.slug },
    locale: parsed.data.locale,
    requestType: "console_preview",
    message: parsed.data.message,
  });

  revalidatePath(`/${parsed.data.locale}/t/${parsed.data.slug}/agent`);
  return { message: parsed.data.message, result };
}
