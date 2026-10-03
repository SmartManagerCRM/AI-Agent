import "server-only";

import { timed } from "@/server/perf";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type CustomerRow = {
  key: string;
  /** Set for a customer the business saved itself; null for one known only from orders. */
  customerId: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  notes: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string | null;
};

export type CustomerSummary = {
  /** Every customer this tenant has, regardless of the search. */
  customers: number;
  repeatCustomers: number;
  totalSpentMinor: number;
  /** Customers matching the search — what the pager pages through. */
  filteredCount: number;
  rows: CustomerRow[];
};

/**
 * Customers the business saved itself (`customers`) and customers known
 * only from their orders (orders carry name/email/phone inline; such a
 * customer is `email ?? phone ?? name`). Orders are matched to a saved
 * customer by email or phone. Grouping, sums and the spend-ordered page are
 * computed in Postgres (`tenant_customer_summary`, SECURITY INVOKER — the
 * same RLS as a direct select) rather than by downloading every order.
 */
export async function getTenantCustomers(
  supabase: TypedSupabaseClient,
  tenantId: string,
  options: { search: string | undefined; page: number; pageSize: number },
): Promise<CustomerSummary> {
  const { data, error } = await timed(
    "customers.summary",
    supabase.rpc("tenant_customer_summary", {
      p_tenant_id: tenantId,
      p_search: options.search ?? null,
      p_limit: options.pageSize,
      p_offset: (options.page - 1) * options.pageSize,
    }),
  );
  if (error) throw new Error(`Failed to load customers: ${error.message}`);

  return {
    customers: Number(data?.customers ?? 0),
    repeatCustomers: Number(data?.repeat_customers ?? 0),
    totalSpentMinor: Number(data?.total_spent_minor ?? 0),
    filteredCount: Number(data?.filtered_count ?? 0),
    rows: (data?.rows ?? []).map((r) => ({
      key: r.key,
      customerId: r.customer_id ?? null,
      name: r.name,
      email: r.email,
      phone: r.phone,
      birthday: r.birthday ?? null,
      notes: r.notes ?? null,
      orderCount: Number(r.order_count),
      totalSpentMinor: Number(r.total_spent_minor),
      lastOrderAt: r.last_order_at,
    })),
  };
}
