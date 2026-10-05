import { AlertDeviceSettings } from "@/components/notifications/alert-device-settings";
import { BusinessLogoForm } from "@/components/business/business-logo-form";
import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { KeptWordsForm } from "@/components/business/kept-words-form";
import { CheckoutSettingsForm } from "@/components/commerce/checkout-settings-form";
import { PaymentSettingsForm } from "@/components/commerce/payment-settings-form";
import { consoleOrigin } from "@/lib/hosts";
import { productImageUrl } from "@/lib/product-image";
import { timeZoneOptions } from "@/lib/timezone";
import { serverEnv } from "@/server/env";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.settings");
  const tk = await getTranslations("console.keptWords");

  const [{ data: settings }, { data: translation }, { data: currency }, { data: paymentConfig }] = await Promise.all([
    supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
    // Read on its own, so the checkout settings never depend on it.
    supabase.from("tenant_settings").select("translation").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase
      .from("tenant_payment_config")
      .select(
        "enabled_methods, moyasar_secret_key, tap_secret_key, stripe_secret_key, stripe_webhook_secret, paypal_client_id, paypal_client_secret, paypal_test_mode, hyperpay_access_token, hyperpay_entity_id, hyperpay_mada_entity_id, hyperpay_test_mode, myfatoorah_api_token, myfatoorah_country, myfatoorah_test_mode",
      )
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <AlertDeviceSettings />

      <section id="logo" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("logo")}</h2>
        <BusinessLogoForm
          slug={slug}
          locale={locale}
          businessName={tenant.business_name[locale] ?? Object.values(tenant.business_name)[0] ?? tenant.slug}
          currentUrl={productImageUrl(tenant.logo_path)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("profile")}</h2>
        <BusinessProfileForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          timeZones={timeZoneOptions()}
          current={{
            contact_email: tenant.contact_email,
            contact_phone: tenant.contact_phone,
            website_url: tenant.website_url,
            timezone: tenant.timezone,
            country: tenant.country,
            city: tenant.city,
          }}
        />
      </section>

      <section id="translation" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{tk("title")}</h2>
        <KeptWordsForm slug={slug} locale={locale} words={translation?.translation?.keep_words ?? []} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("checkout")}</h2>
        <CheckoutSettingsForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          currencyExponent={currency?.exponent ?? 2}
          current={
            settings?.checkout ?? {
              ordering_enabled: false,
              fulfillment_types: ["pickup"],
              delivery_fee_minor: 0,
              minimum_order_minor: 0,
              tax_rate_bps: 0,
              tax_included: false,
            }
          }
        />
      </section>

      {paymentConfig && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("payments")}</h2>
          <PaymentSettingsForm
            tenantId={tenant.id}
            slug={slug}
            locale={locale}
            webhookBase={`${webhookOrigin()}/api/payments/webhook`}
            current={{
              enabled_methods: paymentConfig.enabled_methods,
              hasMoyasarKey: Boolean(paymentConfig.moyasar_secret_key),
              hasTapKey: Boolean(paymentConfig.tap_secret_key),
              hasStripeKey: Boolean(paymentConfig.stripe_secret_key),
              hasStripeWebhookSecret: Boolean(paymentConfig.stripe_webhook_secret),
              hasPaypalClientId: Boolean(paymentConfig.paypal_client_id),
              hasPaypalSecret: Boolean(paymentConfig.paypal_client_secret),
              paypalTestMode: paymentConfig.paypal_test_mode,
              hasHyperpayToken: Boolean(paymentConfig.hyperpay_access_token),
              hasHyperpayEntity: Boolean(paymentConfig.hyperpay_entity_id),
              hasHyperpayMadaEntity: Boolean(paymentConfig.hyperpay_mada_entity_id),
              hyperpayTestMode: paymentConfig.hyperpay_test_mode,
              hasMyfatoorahToken: Boolean(paymentConfig.myfatoorah_api_token),
              myfatoorahCountry: paymentConfig.myfatoorah_country,
              myfatoorahTestMode: paymentConfig.myfatoorah_test_mode,
            }}
          />
        </section>
      )}
    </div>
  );
}

/** The app's public address, where payment gateways send their webhooks. */
function webhookOrigin(): string {
  const env = serverEnv();
  return consoleOrigin({
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
    consoleUrl: env.CONSOLE_URL,
  });
}
