"use server";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { LOCALES } from "@/i18n/locales";
import type { AgentGreetings } from "@/lib/agent-greeting";
import { bucketWriter, normalizeImage } from "@/server/catalog/product-images";

import { runAgentGateway, type GatewayResult } from "@/server/ai/gateway";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const greetingText = z.string().trim().max(300).optional().or(z.literal(""));

const updateSettingsSchema = z.object({
  tenantId: z.uuid(),
  assistantName: z.string().trim().max(80).optional().or(z.literal("")),
  greetings: z.object({ en: greetingText, ar: greetingText, fr: greetingText }),
  tone: z.enum(["friendly", "formal", "playful"]),
  voice: z.enum(["male", "female"]).default("male"),
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
    greetings: Object.fromEntries(LOCALES.map((l) => [l, formData.get(`greeting_${l}`) ?? undefined])),
    tone: formData.get("tone"),
    voice: formData.get("voice") ?? undefined,
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return `VALIDATION_ERROR: ${parsed.error.issues[0]?.message ?? "check the form fields."}`;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  // Whether the Agent is on is decided by Go live (publish / pause), not by this form — keep it as stored.
  const { data: current } = await supabase
    .from("tenant_settings")
    .select("agent")
    .eq("tenant_id", parsed.data.tenantId)
    .maybeSingle();
  // One greeting per language; `greeting` keeps the first one for readers that know only a single greeting.
  const greetings: AgentGreetings = {};
  for (const l of LOCALES) {
    const text = parsed.data.greetings[l];
    if (text) greetings[l] = text;
  }
  const { error } = await supabase
    .from("tenant_settings")
    .update({
      agent: {
        active: current?.agent?.active ?? false,
        assistant_name: parsed.data.assistantName || null,
        greeting: LOCALES.map((l) => greetings[l]).find(Boolean) ?? null,
        greetings,
        tone: parsed.data.tone,
        background_path: current?.agent?.background_path ?? null,
        voice: parsed.data.voice,
      },
    })
    .eq("tenant_id", parsed.data.tenantId);
  if (error) return "VALIDATION_ERROR: could not save Agent settings — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/agent`);
}

const backgroundSchema = z.object({ locale: z.string(), slug: z.string().min(1) });
const MAX_BACKGROUND_BYTES = 6_000_000;
/** Wide enough for a desktop screen, still light on a phone (WebP). */
const BACKGROUND_EDGE = 1600;

export type AgentBackgroundState = { ok: boolean; message: string } | undefined;

/**
 * The photo behind the whole customer Agent (Agent settings → Background
 * photo): re-encoded to WebP, stored in the catalog-images bucket, and
 * pointed at from `tenant_settings.agent.background_path`. The settings
 * update runs under the owner's own session (RLS), so someone without
 * permission to change settings changes nothing and the file is removed.
 */
export async function updateAgentBackgroundAction(_prev: AgentBackgroundState, formData: FormData): Promise<AgentBackgroundState> {
  const parsed = backgroundSchema.safeParse({ locale: formData.get("locale"), slug: formData.get("slug") });
  if (!parsed.success) return { ok: false, message: "Something went wrong — please reload the page." };
  const { tenant } = await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const remove = formData.get("remove") === "on";
  const file = formData.get("photo");
  if (!remove && (!(file instanceof File) || file.size === 0)) return { ok: false, message: "Choose a photo first." };
  if (file instanceof File && file.size > MAX_BACKGROUND_BYTES) return { ok: false, message: "That photo is larger than 6 MB. Choose a smaller one." };

  let storage;
  try {
    storage = bucketWriter(serviceClient());
  } catch {
    return { ok: false, message: "Photos can't be stored on this server yet (storage isn't configured)." };
  }
  const supabase = await createUserClient();
  const { data: current } = await supabase.from("tenant_settings").select("agent").eq("tenant_id", tenant.id).maybeSingle();
  if (!current) return { ok: false, message: "Only the business owner or an admin can change the Agent." };
  const previous = current.agent?.background_path ?? null;

  let path: string | null = null;
  if (!remove && file instanceof File) {
    const image = await normalizeImage(new Uint8Array(await file.arrayBuffer()), { maxEdge: BACKGROUND_EDGE }).catch(() => null);
    if (!image) return { ok: false, message: "That photo couldn't be used. Upload a JPG, PNG or WebP picture." };
    const hash = createHash("sha256").update(image.data).digest("hex").slice(0, 16);
    path = `${tenant.id}/agent-background-${hash}.webp`;
    if (path !== previous && !(await storage.upload(path, image.data, image.contentType))) {
      return { ok: false, message: "The photo couldn't be saved — please try again." };
    }
  }

  const { data: updated } = await supabase
    .from("tenant_settings")
    .update({ agent: { ...current.agent, background_path: path } })
    .eq("tenant_id", tenant.id)
    .select("tenant_id");
  if (!updated || updated.length === 0) {
    if (path && path !== previous) await storage.remove([path]);
    return { ok: false, message: "Only the business owner or an admin can change the Agent." };
  }
  if (previous && previous !== path) await storage.remove([previous]);
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/agent`);
  return { ok: true, message: path ? "Background photo saved — it now shows behind your Agent." : "Background photo removed." };
}

const testMessageSchema = z.object({
  tenantId: z.uuid(),
  currency: z.string().length(3),
  slug: z.string().min(1),
  locale: z.string(),
  message: z.string().trim().min(1).max(1000),
});

/** What the console preview may show a subscriber: the reply and how it was handled — never its AI cost. */
export type PreviewResult = DistributiveOmit<GatewayResult, "costUsd" | "cart">;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type TestAgentState = { message: string; result: PreviewResult } | { message: string; error: string } | undefined;

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

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/agent`);
  // Stripped here, on the server: the cost must not reach the browser at all.
  const { costUsd: _cost, cart: _cart, ...preview } = result as GatewayResult & { costUsd?: number; cart?: unknown };
  return { message: parsed.data.message, result: preview as PreviewResult };
}
