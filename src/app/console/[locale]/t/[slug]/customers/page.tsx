import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { SearchInput } from "@/components/console/search-input";
import { formatMoney } from "@/lib/money";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

type CustomerRow = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string;
};

/**
 * There is no `customers` table in this schema — orders carry the
 * customer's name/email/phone inline. This derives a customer list from
 * that, grouped by email (falling back to phone, then name) as the best
 * identity key available. No new table, no fabricated data.
 */
export default async function CustomersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale, slug } = await params;
  const { q } = await searchParams;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: orders }, { data: currency }] = await Promise.all([
    supabase
      .from("orders")
      .select("customer_name, customer_email, customer_phone, total_minor, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("currencies").select("exponent").eq("code", tenant.currency).maybeSingle(),
  ]);
  const exponent = currency?.exponent ?? 2;
  const money = (minor: number) => formatMoney(minor, tenant.currency, exponent, locale);

  const byKey = new Map<string, CustomerRow>();
  for (const order of orders ?? []) {
    const key = order.customer_email ?? order.customer_phone ?? order.customer_name ?? "unknown";
    const existing = byKey.get(key);
    if (existing) {
      existing.orderCount += 1;
      existing.totalSpentMinor += order.total_minor;
      if (order.created_at > existing.lastOrderAt) existing.lastOrderAt = order.created_at;
    } else {
      byKey.set(key, {
        key,
        name: order.customer_name ?? "—",
        email: order.customer_email,
        phone: order.customer_phone,
        orderCount: 1,
        totalSpentMinor: order.total_minor,
        lastOrderAt: order.created_at,
      });
    }
  }
  const allCustomers = Array.from(byKey.values()).sort((a, b) => b.totalSpentMinor - a.totalSpentMinor);
  const customers = q ? allCustomers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : allCustomers;

  const totalSpentMinor = allCustomers.reduce((sum, c) => sum + c.totalSpentMinor, 0);
  const repeatCustomers = allCustomers.filter((c) => c.orderCount > 1).length;

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
          value={String(allCustomers.length)}
          trend={null}
        />
        <KpiTile icon="orders" accent="blue" label="Repeat customers" value={String(repeatCustomers)} trend={null} />
        <KpiTile icon="billing" accent="purple" label="Total spent" value={money(totalSpentMinor)} trend={null} />
        <KpiTile
          icon="analytics"
          accent="orange"
          label="Avg. spend / customer"
          value={money(allCustomers.length > 0 ? Math.round(totalSpentMinor / allCustomers.length) : 0)}
          trend={null}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
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
              title={allCustomers.length === 0 ? "No customers yet" : "No customers match your search"}
              description={
                allCustomers.length === 0
                  ? "Customers appear here automatically once they place their first order through your AI Agent."
                  : "Try a different search term."
              }
              actionLabel={allCustomers.length === 0 ? "Set up your Agent" : undefined}
              actionHref={allCustomers.length === 0 ? `/${locale}/${slug}/agent` : undefined}
            />
          </div>
        )}
      </div>
    </div>
  );
}
