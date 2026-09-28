"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const schema = z.object({
  tenantId: z.uuid(),
  moyasar: z.enum(["on"]).optional(),
  tap: z.enum(["on"]).optional(),
  cashOnDelivery: z.enum(["on"]).optional(),
  payOnTable: z.enum(["on"]).optional(),
  // Blank means "leave the stored key unchanged" — the console never
  // redisplays a saved secret key, so there is nothing to diff against;
  // this is the standard "write-only credential field" convention.
  moyasarSecretKey: z.string().trim().max(200).optional(),
  tapSecretKey: z.string().trim().max(200).optional(),
  locale: z.string(),
  slug: z.string().min(1),
});

/**
 * Payment method configuration (Moyasar, Tap, Cash on Delivery, Pay on
 * Table) — a separate action/table from checkout settings
 * (`tenant_settings.checkout`) because `tenant_payment_config` carries
 * secret keys and is gated by `settings.write` for reads too, not just
 * writes (plain staff with only `settings.read` never sees this form's
 * current values at all — see the migration's own comment on why).
 */
export async function updatePaymentSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const parsed = schema.safeParse({
    tenantId: formData.get("tenantId"),
    moyasar: formData.get("moyasar") ?? undefined,
    tap: formData.get("tap") ?? undefined,
    cashOnDelivery: formData.get("cashOnDelivery") ?? undefined,
    payOnTable: formData.get("payOnTable") ?? undefined,
    moyasarSecretKey: formData.get("moyasarSecretKey") ?? "",
    tapSecretKey: formData.get("tapSecretKey") ?? "",
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return "VALIDATION_ERROR: check the form fields.";

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();

  type EnabledMethod = "moyasar" | "tap" | "cash_on_delivery" | "pay_on_table";
  const enabledMethods: EnabledMethod[] = [];
  if (parsed.data.moyasar === "on") enabledMethods.push("moyasar");
  if (parsed.data.tap === "on") enabledMethods.push("tap");
  if (parsed.data.cashOnDelivery === "on") enabledMethods.push("cash_on_delivery");
  if (parsed.data.payOnTable === "on") enabledMethods.push("pay_on_table");

  const patch: { enabled_methods: EnabledMethod[]; moyasar_secret_key?: string; tap_secret_key?: string } = {
    enabled_methods: enabledMethods,
  };
  if (parsed.data.moyasarSecretKey) patch.moyasar_secret_key = parsed.data.moyasarSecretKey;
  if (parsed.data.tapSecretKey) patch.tap_secret_key = parsed.data.tapSecretKey;

  const { error } = await supabase.from("tenant_payment_config").update(patch).eq("tenant_id", parsed.data.tenantId);
  if (error) return "VALIDATION_ERROR: could not save payment settings — please try again.";

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/settings`);
}
