"use server";

import { actionT } from "@/server/i18n/action-messages";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { Database } from "@/types/database";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

// Blank means "leave the stored value unchanged" — the console never
// redisplays a saved credential, so there is nothing to diff against; this
// is the standard "write-only credential field" convention.
const credential = z.string().trim().max(500).optional();
const on = z.enum(["on"]).optional();

const schema = z.object({
  tenantId: z.uuid(),
  moyasar: on,
  tap: on,
  stripe: on,
  paypal: on,
  hyperpay: on,
  myfatoorah: on,
  cashOnDelivery: on,
  payOnTable: on,
  moyasarSecretKey: credential,
  tapSecretKey: credential,
  stripeSecretKey: credential,
  stripeWebhookSecret: credential,
  paypalClientId: credential,
  paypalClientSecret: credential,
  paypalTestMode: on,
  hyperpayAccessToken: credential,
  hyperpayEntityId: credential,
  hyperpayMadaEntityId: credential,
  hyperpayTestMode: on,
  myfatoorahApiToken: credential,
  myfatoorahCountry: z.enum(["KWT", "SAU", "ARE", "QAT", "BHR", "OMN", "JOR", "EGY"]),
  myfatoorahTestMode: on,
  locale: z.string(),
  slug: z.string().min(1),
});

type ConfigRow = Database["public"]["Tables"]["tenant_payment_config"]["Row"];
type EnabledMethod = ConfigRow["enabled_methods"][number];

/** What each newer gateway needs saved before it can be offered to customers. */
const REQUIRED: Partial<Record<EnabledMethod, (keyof ConfigRow)[]>> = {
  stripe: ["stripe_secret_key"],
  paypal: ["paypal_client_id", "paypal_client_secret"],
  hyperpay: ["hyperpay_access_token", "hyperpay_entity_id"],
  myfatoorah: ["myfatoorah_api_token"],
};

/**
 * Payment method configuration (Moyasar, Tap, Stripe, PayPal, HyperPay,
 * MyFatoorah, Cash on Delivery, Pay on Table) — a separate action/table from
 * checkout settings (`tenant_settings.checkout`) because
 * `tenant_payment_config` carries secret keys and is gated by
 * `settings.write` for reads too, not just writes (plain staff with only
 * `settings.read` never sees this form's current values at all — see the
 * migration's own comment on why).
 */
export async function updatePaymentSettingsAction(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  const field = (name: string) => formData.get(name) ?? undefined;
  const text = (name: string) => formData.get(name) ?? "";
  const parsed = schema.safeParse({
    tenantId: formData.get("tenantId"),
    moyasar: field("moyasar"),
    tap: field("tap"),
    stripe: field("stripe"),
    paypal: field("paypal"),
    hyperpay: field("hyperpay"),
    myfatoorah: field("myfatoorah"),
    cashOnDelivery: field("cashOnDelivery"),
    payOnTable: field("payOnTable"),
    moyasarSecretKey: text("moyasarSecretKey"),
    tapSecretKey: text("tapSecretKey"),
    stripeSecretKey: text("stripeSecretKey"),
    stripeWebhookSecret: text("stripeWebhookSecret"),
    paypalClientId: text("paypalClientId"),
    paypalClientSecret: text("paypalClientSecret"),
    paypalTestMode: field("paypalTestMode"),
    hyperpayAccessToken: text("hyperpayAccessToken"),
    hyperpayEntityId: text("hyperpayEntityId"),
    hyperpayMadaEntityId: text("hyperpayMadaEntityId"),
    hyperpayTestMode: field("hyperpayTestMode"),
    myfatoorahApiToken: text("myfatoorahApiToken"),
    myfatoorahCountry: formData.get("myfatoorahCountry") ?? "KWT",
    myfatoorahTestMode: field("myfatoorahTestMode"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return t("checkFields");
  const d = parsed.data;

  await requireTenantMember(d.locale, d.slug);
  const supabase = await createUserClient();

  const enabledMethods: EnabledMethod[] = [];
  if (d.moyasar === "on") enabledMethods.push("moyasar");
  if (d.tap === "on") enabledMethods.push("tap");
  if (d.stripe === "on") enabledMethods.push("stripe");
  if (d.paypal === "on") enabledMethods.push("paypal");
  if (d.hyperpay === "on") enabledMethods.push("hyperpay");
  if (d.myfatoorah === "on") enabledMethods.push("myfatoorah");
  if (d.cashOnDelivery === "on") enabledMethods.push("cash_on_delivery");
  if (d.payOnTable === "on") enabledMethods.push("pay_on_table");

  const patch: Partial<ConfigRow> = {
    enabled_methods: enabledMethods,
    paypal_test_mode: d.paypalTestMode === "on",
    hyperpay_test_mode: d.hyperpayTestMode === "on",
    myfatoorah_country: d.myfatoorahCountry,
    myfatoorah_test_mode: d.myfatoorahTestMode === "on",
  };
  if (d.moyasarSecretKey) patch.moyasar_secret_key = d.moyasarSecretKey;
  if (d.tapSecretKey) patch.tap_secret_key = d.tapSecretKey;
  if (d.stripeSecretKey) patch.stripe_secret_key = d.stripeSecretKey;
  if (d.stripeWebhookSecret) patch.stripe_webhook_secret = d.stripeWebhookSecret;
  if (d.paypalClientId) patch.paypal_client_id = d.paypalClientId;
  if (d.paypalClientSecret) patch.paypal_client_secret = d.paypalClientSecret;
  if (d.hyperpayAccessToken) patch.hyperpay_access_token = d.hyperpayAccessToken;
  if (d.hyperpayEntityId) patch.hyperpay_entity_id = d.hyperpayEntityId;
  if (d.hyperpayMadaEntityId) patch.hyperpay_mada_entity_id = d.hyperpayMadaEntityId;
  if (d.myfatoorahApiToken) patch.myfatoorah_api_token = d.myfatoorahApiToken;

  // A gateway is offered to customers only once its credentials are saved.
  const enabledNeedingKeys = Object.entries(REQUIRED).filter(([method]) => enabledMethods.includes(method as EnabledMethod));
  if (enabledNeedingKeys.length > 0) {
    const { data: current } = await supabase.from("tenant_payment_config").select("*").eq("tenant_id", d.tenantId).maybeSingle();
    for (const [method, columns] of enabledNeedingKeys) {
      if ((columns ?? []).some((column) => !(patch[column] ?? current?.[column]))) {
        return t("checkout.gatewayNeedsKeys", { gateway: t(`checkout.gateway.${method}`) });
      }
    }
  }

  const { error } = await supabase.from("tenant_payment_config").update(patch).eq("tenant_id", d.tenantId);
  if (error) return t("checkout.paymentsFailed");

  revalidatePath(`/${d.locale}/${d.slug}/settings`);
}
