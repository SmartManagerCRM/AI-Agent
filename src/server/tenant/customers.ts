import "server-only";

import { timed } from "@/server/perf";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

export type CustomerRow = {
  key: string;
  name: string;
  email: string | null;
  phone: string | null;
  orderCount: number;
  totalSpentMinor: number;
  lastOrderAt: string;
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
 * There is no `customers` table — orders carry the customer's
 * name/email/phone inline, and a customer is `email ?? phone ?? name`.
 * Grouping, sums and the spend-ordered page are computed in Postgres
 * (`tenant_customer_summary`, SECURITY INVOKER — the same RLS as a direct
 * select) rather than by downloading every order this tenant ever had.
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
      name: r.name,
      email: r.email,
      phone: r.phone,
      orderCount: Number(r.order_count),
      totalSpentMinor: Number(r.total_spent_minor),
      lastOrderAt: r.last_order_at,
    })),
  };
}
