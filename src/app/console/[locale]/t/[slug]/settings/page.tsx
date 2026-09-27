import { CheckoutSettingsForm } from "@/components/commerce/checkout-settings-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function SettingsPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: settings }, { data: currency }] = await Promise.all([
    supabase.from("tenant_settings").select("checkout").eq("tenant_id", tenant.id).maybeSingle(),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Ordering &amp; checkout</h2>
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
    </div>
  );
}
