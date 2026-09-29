import { CreateCouponForm } from "@/components/marketing/create-coupon-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { formatMoney } from "@/lib/money";
import { toggleCouponAction } from "@/server/marketing/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  disabled: "bg-slate-100 text-slate-500",
};

function discountLabel(
  coupon: { discount_type: string; discount_value: number },
  currency: string,
  exponent: number,
  locale: string,
): string {
  return coupon.discount_type === "percentage"
    ? `${coupon.discount_value / 100}% off`
    : `${formatMoney(coupon.discount_value, currency, exponent, locale)} off`;
}

export default async function MarketingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: coupons }, { data: currencyRow }, { data: discountTotal }] = await Promise.all([
    supabase.from("coupons").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
    // Summed in Postgres rather than downloading every coupon-discounted order.
    supabase.rpc("tenant_coupon_discount_total", { p_tenant_id: tenant.id }),
  ]);
  const exponent = currencyRow?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const activeCount = (coupons ?? []).filter((c) => c.status === "active").length;
  const totalRedemptions = (coupons ?? []).reduce((sum, c) => sum + c.times_used, 0);
  const totalDiscountMinor = Number(discountTotal ?? 0);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Marketing</h1>
        <p className="mt-1 text-sm text-slate-500">
          Discount codes your Agent and website checkout will honor automatically — no other marketing channels yet.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile icon="marketing" accent="emerald" label="Active coupons" value={String(activeCount)} trend={null} />
        <KpiTile icon="orders" accent="blue" label="Redemptions" value={String(totalRedemptions)} trend={null} />
        <KpiTile icon="billing" accent="purple" label="Discount given" value={money(totalDiscountMinor)} trend={null} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Create a coupon</h2>
        <CreateCouponForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          currency={tenant.currency}
          currencyExponent={exponent}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Coupons</h2>
        {(coupons ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">Code</th>
                  <th className="py-2 text-start font-medium">Discount</th>
                  <th className="py-2 text-start font-medium">Usage</th>
                  <th className="py-2 text-start font-medium">Valid</th>
                  <th className="py-2 text-start font-medium">Status</th>
                  <th className="py-2 text-start font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(coupons ?? []).map((coupon) => (
                  <tr key={coupon.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <p className="font-medium text-slate-900">{coupon.code}</p>
                      {coupon.description && <p className="text-xs text-slate-500">{coupon.description}</p>}
                    </td>
                    <td className="py-2 text-slate-700">{discountLabel(coupon, tenant.currency, exponent, locale)}</td>
                    <td className="py-2 text-slate-600">
                      {coupon.times_used}
                      {coupon.usage_limit ? ` / ${coupon.usage_limit}` : ""}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {coupon.starts_at ? new Date(coupon.starts_at).toLocaleDateString(locale) : "Any time"}
                      {coupon.ends_at ? ` – ${new Date(coupon.ends_at).toLocaleDateString(locale)}` : ""}
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[coupon.status]}`}
                      >
                        {coupon.status}
                      </span>
                    </td>
                    <td className="py-2">
                      <form action={toggleCouponAction}>
                        <input type="hidden" name="couponId" value={coupon.id} />
                        <input type="hidden" name="status" value={coupon.status === "active" ? "disabled" : "active"} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs font-medium text-slate-600 hover:underline">
                          {coupon.status === "active" ? "Disable" : "Enable"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No coupons yet"
            description="Create one above — your Agent will offer it and honor it automatically at checkout."
          />
        )}
      </section>
    </div>
  );
}
