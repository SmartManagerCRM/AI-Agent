import { AlertDeviceSettings } from "@/components/notifications/alert-device-settings";
import { BusinessLogoForm } from "@/components/business/business-logo-form";
import { BusinessProfileForm } from "@/components/business/business-profile-form";
import { CheckoutSettingsForm } from "@/components/commerce/checkout-settings-form";
import { PaymentSettingsForm } from "@/components/commerce/payment-settings-form";
import { productImageUrl } from "@/lib/product-image";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: settings }, { data: currency }, { data: paymentConfig }] = await Promise.all([
    supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    supabase.from("tenant_payment_config").select("enabled_methods, moyasar_secret_key, tap_secret_key").eq("tenant_id", tenant.id).maybeSingle(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Settings</h1>

      <AlertDeviceSettings />

      <section id="logo" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Logo</h2>
        <BusinessLogoForm
          slug={slug}
          locale={locale}
          businessName={tenant.business_name[locale] ?? Object.values(tenant.business_name)[0] ?? tenant.slug}
          currentUrl={productImageUrl(tenant.logo_path)}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Business profile</h2>
        <BusinessProfileForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Ordering &amp; checkout</h2>
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
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Payment methods</h2>
          <PaymentSettingsForm
            tenantId={tenant.id}
            slug={slug}
            locale={locale}
            current={{
              enabled_methods: paymentConfig.enabled_methods,
              hasMoyasarKey: Boolean(paymentConfig.moyasar_secret_key),
              hasTapKey: Boolean(paymentConfig.tap_secret_key),
            }}
          />
        </section>
      )}
    </div>
  );
}
