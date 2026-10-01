import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import { SearchInput } from "@/components/console/search-input";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTenantCustomers } from "@/server/tenant/customers";

const PAGE_SIZE = 50;

/**
 * There is no `customers` table in this schema — orders carry the
 * customer's name/email/phone inline. This derives a customer list from
 * that, grouped by email (falling back to phone, then name) as the best
 * identity key available. No new table, no fabricated data. Aggregated in
 * Postgres and paged server-side (`getTenantCustomers`).
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Customers</h1>
        <SearchInput placeholder="Search customers..." defaultValue={q} />
      </div>

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
                </tr>
              </thead>
              <tbody>
                {customers.map((customer) => (
                  <tr key={customer.key} className="border-b border-slate-100 last:border-0">
                    <td className="flex items-center gap-2 px-4 py-3 font-medium text-slate-900">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500">
                        {customer.name.charAt(0).toUpperCase()}
                      </span>
                      {customer.name}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{customer.email ?? customer.phone ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-700">{customer.orderCount}</td>
                    <td className="px-4 py-3 text-slate-700">{money(customer.totalSpentMinor)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {new Date(customer.lastOrderAt).toLocaleDateString(locale)}
                    </td>
                  </tr>
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
                  ? "Customers appear here automatically once they place their first order through your AI Agent."
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
