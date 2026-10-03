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

  const [summary, { data: currency }] = await Promise.all([
    getTenantCustomers(supabase, tenant.id, { search: q, page, pageSize: PAGE_SIZE }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const customers = summary.rows;
  const totalCustomers = summary.customers;
  const totalSpentMinor = summary.totalSpentMinor;
  const repeatCustomers = summary.repeatCustomers;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
        <SearchInput placeholder="Search by name, phone or email..." defaultValue={q} />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="add-customer">
        <h2 className="text-sm font-semibold text-slate-900">Add a customer</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Walk-ins, regulars, people who call — save them here. Customers who order through your AI Agent appear automatically.
        </p>
        <Disclosure summary="New customer" initiallyOpen={totalCustomers === 0}>
          <CustomerForm locale={locale} slug={slug} initial={NEW_CUSTOMER} />
        </Disclosure>
      </section>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile
          icon="customers"
          accent="emerald"
          label="Total customers"
          value={String(totalCustomers)}
          trend={null}
          href={`/${locale}/${slug}/customers#customers`}
        />
        <KpiTile icon="orders" accent="blue" label="Repeat customers" value={String(repeatCustomers)} trend={null} href={`/${locale}/${slug}/customers#customers`} />
        <KpiTile icon="billing" accent="purple" label="Total spent" value={money(totalSpentMinor)} trend={null} href={`/${locale}/${slug}/orders?status=completed`} />
        <KpiTile
          icon="analytics"
          accent="orange"
          label="Avg. spend / customer"
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
                  <th className="px-4 py-2 text-start font-medium">Customer</th>
                  <th className="px-4 py-2 text-start font-medium">Contact</th>
                  <th className="px-4 py-2 text-start font-medium">Orders</th>
                  <th className="px-4 py-2 text-start font-medium">Total spent</th>
                  <th className="px-4 py-2 text-start font-medium">Last order</th>
                  <th className="px-4 py-2 text-end font-medium">
                    <span className="sr-only">Actions</span>
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
              title={totalCustomers === 0 ? "No customers yet" : "No customers match your search"}
              description={
                totalCustomers === 0
                  ? "Add your first customer above — customers who order through your AI Agent also appear here automatically."
                  : "Try a different search term."
              }
              actionLabel={totalCustomers === 0 ? "Set up your Agent" : undefined}
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
