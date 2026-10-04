import { Disclosure } from "@/components/console/disclosure";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { SearchInput } from "@/components/console/search-input";
import { CustomerForm, CustomerRow, NEW_CUSTOMER } from "@/components/customers/customer-ui";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTenantCustomers } from "@/server/tenant/customers";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";

const PAGE_SIZE = 50;

/**
 * Customers the business added itself (Add customer) together with the
 * customers known from orders (orders carry name/email/phone inline,
 * grouped by email, else phone, else name). A saved customer's orders are
 * matched by email or phone. Aggregated in Postgres and paged server-side
 * (`getTenantCustomers`). No fabricated data.
 */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale, slug } = await params;
  const { q, page: pageParam } = await searchParams;
  const page = parsePage(pageParam);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.customers");

  const [summary, { data: currency }] = await Promise.all([
    getTenantCustomers(supabase, tenant.id, { search: q, page, pageSize: PAGE_SIZE }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const customers = summary.rows;
  // Which saved customers are suspended (the summary doesn't carry it).
  const savedIds = customers.map((c) => c.customerId).filter((id): id is string => !!id);
  const { data: activeRows } = savedIds.length
    ? await supabase.from("customers").select("id, is_active").eq("tenant_id", tenant.id).in("id", savedIds)
    : { data: [] };
  const activeById = new Map((activeRows ?? []).map((r) => [r.id, r.is_active]));
  const totalCustomers = summary.customers;
  const totalSpentMinor = summary.totalSpentMinor;
  const repeatCustomers = summary.repeatCustomers;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.customers.customers" /></h1>
        <SearchInput placeholder={t("searchPlaceholder")} defaultValue={q} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="add-customer">
        <h2 className="text-sm font-semibold text-slate-900"><Msg id="console.customers.addACustomer" /></h2>
        <p className="mt-0.5 text-xs text-slate-500">
          <Msg id="console.customers.walkInsRegularsPeopleWho" />
        </p>
        <Disclosure summary={t("newCustomer")} initiallyOpen={totalCustomers === 0}>
          <CustomerForm locale={locale} slug={slug} initial={NEW_CUSTOMER} />
        </Disclosure>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="customers"
          accent="emerald"
          label={t("totalCustomers")}
          value={String(totalCustomers)}
          trend={null}
          href={`/${locale}/${slug}/customers#customers`}
        />
        <KpiTile icon="orders" accent="blue" label={t("repeatCustomers")} value={String(repeatCustomers)} trend={null} href={`/${locale}/${slug}/customers#customers`} />
        <KpiTile icon="billing" accent="purple" label={t("totalSpent")} value={money(totalSpentMinor)} trend={null} href={`/${locale}/${slug}/orders?status=completed`} />
        <KpiTile
          icon="analytics"
          accent="orange"
          label={t("avgSpend")}
          value={money(totalCustomers > 0 ? Math.round(totalSpentMinor / totalCustomers) : 0)}
          trend={null}
          href={`/${locale}/${slug}/analytics`}
        />
      </div>

      <div id="customers" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white">
        {customers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.customers.customer" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.customers.contact" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.customers.orders" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.customers.totalSpent" /></th>
                  <th className="px-4 py-2 text-start font-medium"><Msg id="console.customers.lastOrder" /></th>
                  <th className="px-4 py-2 text-end font-medium">
                    <span className="sr-only"><Msg id="console.customers.actions" /></span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <CustomerRow
                    key={customer.key}
                    locale={locale}
                    slug={slug}
                    row={{
                      key: customer.key,
                      customerId: customer.customerId,
                      name: customer.name,
                      email: customer.email,
                      phone: customer.phone,
                      birthday: customer.birthday,
                      notes: customer.notes,
                      isActive: customer.customerId ? (activeById.get(customer.customerId) ?? true) : undefined,
                      orderCount: customer.orderCount,
                      totalSpent: money(customer.totalSpentMinor),
                      lastOrder: customer.lastOrderAt ? new Date(customer.lastOrderAt).toLocaleDateString(locale) : null,
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState
              title={totalCustomers === 0 ? t("emptyTitle") : t("noMatchTitle")}
              description={
                totalCustomers === 0
                  ? t("emptyDescription")
                  : t("tryDifferentSearch")
              }
              actionLabel={totalCustomers === 0 ? t("setUpAgent") : undefined}
              actionHref={totalCustomers === 0 ? `/${locale}/${slug}/agent` : undefined}
            />
          </div>
        )}
        <Pagination
          basePath={`/${locale}/${slug}/customers`}
          params={{ q }}
          page={page}
          pageSize={PAGE_SIZE}
          total={summary.filteredCount}
        />
      </div>
    </div>
  );
}
