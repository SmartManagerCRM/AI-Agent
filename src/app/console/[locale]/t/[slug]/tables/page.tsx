import QRCode from "qrcode";

import { CreateTableForm } from "@/components/commerce/create-table-form";
import { EmptyState } from "@/components/console/empty-state";
import { publicAgentUrls } from "@/server/agent-public/urls";
import { setTableActiveAction } from "@/server/commerce/table-actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

/**
 * Per-branch tables + real QR codes (Customer Agent Master Prompt §25
 * "Dine-in / Table Mode" + §39 "QR Codes"). Every QR here is generated
 * locally from the real `branch_tables` row's own id — never a fabricated
 * table, and never a QR pointing at a table this business doesn't
 * actually have. Scanning it opens the same public Agent
 * (`/agent/[slug]?table=...`), which re-validates that id against this
 * same table before ever trusting it (spec §25/§39's "query parameters
 * are not trusted authorization").
 */
export default async function TablesPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: branches }, { data: tables }] = await Promise.all([
    supabase.from("branches").select("id, name").eq("tenant_id", tenant.id).eq("is_active", true).order("created_at"),
    supabase
      .from("branch_tables")
      .select("id, branch_id, label, is_active, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
  ]);
  const branchNameById = new Map((branches ?? []).map((b) => [b.id, b.name[locale] ?? Object.values(b.name)[0] ?? ""]));

  const agentUrls = publicAgentUrls();

  const tablesWithQr = await Promise.all(
    (tables ?? []).map(async (t) => {
      const url = `${agentUrls.agent(tenant.slug)}?table=${t.id}`;
      const qrDataUrl = await QRCode.toDataURL(url, { width: 160, margin: 1 });
      return { ...t, url, qrDataUrl };
    }),
  );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Tables</h1>
        <p className="mt-1 text-sm text-slate-500">
          Print a table&apos;s QR code and put it on the table — scanning it opens your Agent already set to dine-in for
          that exact table.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Add a table</h2>
        <CreateTableForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          branches={(branches ?? []).map((b) => ({ id: b.id, name: branchNameById.get(b.id) ?? "" }))}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Your tables</h2>
        {tablesWithQr.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {tablesWithQr.map((t) => (
              <div
                key={t.id}
                className="flex flex-col items-center gap-2 rounded-lg border border-slate-100 p-3 text-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated locally by the `qrcode` package, not a project asset */}
                <img src={t.qrDataUrl} alt={`QR code for table ${t.label}`} width={120} height={120} />
                <p className="text-sm font-medium text-slate-900">
                  Table {t.label}{" "}
                  <span className="font-normal text-slate-400">— {branchNameById.get(t.branch_id)}</span>
                </p>
                <form action={setTableActiveAction}>
                  <input type="hidden" name="tableId" value={t.id} />
                  <input type="hidden" name="value" value={(!t.is_active).toString()} />
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="slug" value={slug} />
                  <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                    {t.is_active ? "Active" : "Inactive"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No tables yet" description="Add a table above to generate its QR code." />
        )}
      </section>
    </div>
  );
}
