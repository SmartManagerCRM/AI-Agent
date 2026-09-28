import { NextResponse } from "next/server";

import { toCsv } from "@/lib/csv";
import { getRecentPayments } from "@/server/platform/revenue";
import { getRecentSubscribers } from "@/server/platform/dashboard-stats";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const EXPORT_ROW_LIMIT = 5000;
const ENTITIES = ["businesses", "payments", "subscribers"] as const;
type Entity = (typeof ENTITIES)[number];

/**
 * Super Admin Master Spec — data export (spec §98). CSV only, capped at
 * 5000 rows (this platform's current real scale is nowhere near that;
 * the cap exists so a future much larger platform doesn't accidentally
 * build an unbounded response). `requireSuperAdmin` redirects an
 * unauthorized caller straight to `/login` — Next.js honors `redirect()`
 * from a Route Handler exactly like it does from a page.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params;
  if (!ENTITIES.includes(entity as Entity)) return NextResponse.json({ error: "Unknown export." }, { status: 404 });

  await requireSuperAdmin("en");
  const supabase = await createUserClient();

  let csv: string;
  if (entity === "businesses") {
    const [{ data: tenants }, { data: subscriptions }, { data: businessTypes }] = await Promise.all([
      supabase
        .from("tenants")
        .select("id, slug, business_name, business_type_key, status, country, currency, created_at")
        .order("created_at", { ascending: false })
        .limit(EXPORT_ROW_LIMIT),
      supabase.from("subscriptions").select("tenant_id, plan_key, status"),
      supabase.from("business_types").select("key, name"),
    ]);
    const typeNameByKey = new Map((businessTypes ?? []).map((t) => [t.key, t.name.en ?? t.key]));
    const subByTenant = new Map((subscriptions ?? []).map((s) => [s.tenant_id, s]));

    csv = toCsv(tenants ?? [], [
      { label: "Business name", value: (t) => t.business_name.en ?? t.slug },
      { label: "Slug", value: (t) => t.slug },
      { label: "Type", value: (t) => typeNameByKey.get(t.business_type_key) ?? t.business_type_key },
      { label: "Status", value: (t) => t.status },
      { label: "Country", value: (t) => t.country },
      { label: "Currency", value: (t) => t.currency },
      { label: "Plan", value: (t) => subByTenant.get(t.id)?.plan_key ?? "" },
      { label: "Created at", value: (t) => t.created_at },
    ]);
  } else if (entity === "payments") {
    const payments = await getRecentPayments(supabase, undefined, EXPORT_ROW_LIMIT);
    csv = toCsv(payments, [
      { label: "Business", value: (p) => p.businessName },
      { label: "Plan", value: (p) => p.planLabel },
      { label: "Amount minor", value: (p) => p.amountMinor },
      { label: "Currency", value: (p) => p.currency },
      { label: "Status", value: (p) => p.status },
      { label: "Failure reason", value: (p) => p.failureReason },
      { label: "Created at", value: (p) => p.createdAt },
    ]);
  } else {
    const subscribers = await getRecentSubscribers(supabase, EXPORT_ROW_LIMIT);
    csv = toCsv(subscribers, [
      { label: "Name", value: (s) => s.name },
      { label: "Email", value: (s) => s.email },
      { label: "Business", value: (s) => s.businessName },
      { label: "Business type", value: (s) => s.businessTypeLabel },
      { label: "Plan", value: (s) => s.planLabel },
      { label: "Status", value: (s) => s.status },
      { label: "Joined at", value: (s) => s.joinedAt },
      { label: "Revenue minor", value: (s) => s.revenueMinor },
      { label: "Currency", value: (s) => s.currency },
    ]);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${entity}-export.csv"`,
    },
  });
}
