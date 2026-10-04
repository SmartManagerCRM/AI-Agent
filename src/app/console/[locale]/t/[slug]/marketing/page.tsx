import { CreateCouponForm } from "@/components/marketing/create-coupon-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { formatMoney } from "@/lib/money";
import { ManageControls } from "@/components/console/managed-item";
import { deleteCouponAction, setCouponActiveAction, updateCouponAction } from "@/server/manage/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

const STATUS_STYLE: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700",
  disabled: "bg-slate-100 text-slate-500",
};

function discountLabel(
  coupon: { discount_type: string; discount_value: number },
  currency: string,
  exponent: number,
  locale: string,
  off: (amount: string) => string,
): string {
  return coupon.discount_type === "percentage"
    ? off(`${(coupon.discount_value / 100).toLocaleString(locale)}%`)
    : off(formatMoney(coupon.discount_value, currency, exponent, locale));
}

export default async function MarketingPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.marketing");
  const tAll = await getTranslations();

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
        <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t("subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile icon="marketing" accent="emerald" label={t("activeCoupons")} value={String(activeCount)} trend={null} href={`/${locale}/${slug}/marketing#coupons`} />
        <KpiTile icon="orders" accent="blue" label={t("redemptions")} value={String(totalRedemptions)} trend={null} href={`/${locale}/${slug}/orders`} />
        <KpiTile icon="billing" accent="purple" label={t("discountGiven")} value={money(totalDiscountMinor)} trend={null} href={`/${locale}/${slug}/orders`} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("create")}</h2>
        <CreateCouponForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          currency={tenant.currency}
          currencyExponent={exponent}
        />
      </section>

      <section id="coupons" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("coupons")}</h2>
        {(coupons ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("col.code")}</th>
                  <th className="py-2 text-start font-medium">{t("col.discount")}</th>
                  <th className="py-2 text-start font-medium">{t("col.usage")}</th>
                  <th className="py-2 text-start font-medium">{t("col.valid")}</th>
                  <th className="py-2 text-start font-medium">{t("col.status")}</th>
                  <th className="py-2 text-start font-medium">{t("col.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(coupons ?? []).map((coupon) => (
                  <tr key={coupon.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2">
                      <p className="font-medium text-slate-900">{coupon.code}</p>
                      {coupon.description && <p className="text-xs text-slate-500">{coupon.description}</p>}
                    </td>
                    <td className="py-2 text-slate-700">{discountLabel(coupon, tenant.currency, exponent, locale, (amount) => t("off", { amount }))}</td>
                    <td className="py-2 text-slate-600">
                      {coupon.times_used}
                      {coupon.usage_limit ? ` / ${coupon.usage_limit}` : ""}
                    </td>
                    <td className="py-2 text-xs text-slate-500">
                      {coupon.starts_at ? new Date(coupon.starts_at).toLocaleDateString(locale) : t("anyTime")}
                      {coupon.ends_at ? ` – ${new Date(coupon.ends_at).toLocaleDateString(locale)}` : ""}
                    </td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[coupon.status]}`}
                      >
                        {statusLabel(tAll, coupon.status)}
                      </span>
                    </td>
                    <td className="py-2">
                      <ManageControls
                        testId="coupon-controls"
                        heading={coupon.code}
                        hidden={{ locale, slug, id: coupon.id, currencyExponent: String(exponent) }}
                        fields={[
                          { name: "description", label: tAll("console.manage.description"), defaultValue: coupon.description, maxLength: 200 },
                          {
                            name: "discountType",
                            label: tAll("console.manage.discountType"),
                            type: "select",
                            defaultValue: coupon.discount_type,
                            options: [
                              { value: "percentage", label: tAll("console.manage.percentage") },
                              { value: "fixed", label: tAll("console.manage.fixed") },
                            ],
                          },
                          {
                            name: "discountValue",
                            label: tAll("console.manage.discountValue"),
                            type: "number",
                            required: true,
                            min: 0,
                            step: "any",
                            defaultValue: coupon.discount_type === "percentage" ? coupon.discount_value / 100 : coupon.discount_value / 10 ** exponent,
                          },
                          { name: "minOrderMajor", label: tAll("console.manage.minOrder"), type: "number", min: 0, step: "any", defaultValue: coupon.min_order_minor / 10 ** exponent },
                          { name: "usageLimit", label: tAll("console.manage.usageLimit"), type: "number", min: 1, step: "1", defaultValue: coupon.usage_limit },
                          { name: "startsAt", label: tAll("console.manage.startsAt"), type: "date", defaultValue: coupon.starts_at?.slice(0, 10) },
                          { name: "endsAt", label: tAll("console.manage.endsAt"), type: "date", defaultValue: coupon.ends_at?.slice(0, 10) },
                        ]}
                        update={updateCouponAction}
                        active={coupon.status === "active"}
                        toggle={setCouponActiveAction}
                        remove={deleteCouponAction}
                        deleteConfirm={tAll("console.manage.deleteCoupon", { code: coupon.code })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title={t("emptyTitle")}
            description={t("emptyDescription")}
          />
        )}
      </section>
    </div>
  );
}
