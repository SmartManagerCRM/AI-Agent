import QRCode from "qrcode";

import { CreateTableForm } from "@/components/commerce/create-table-form";
import { EmptyState } from "@/components/console/empty-state";
import { publicAgentUrls } from "@/server/agent-public/urls";
import { ManagedItem } from "@/components/console/managed-item";
import { deleteTableAction, setTableActiveAction, updateTableAction } from "@/server/manage/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";

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
  const tr = await getTranslations("console.tables");
  const tAll = await getTranslations();

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
        <h1 className="text-2xl font-semibold text-slate-900"><Msg id="console.tables.tables" /></h1>
        <p className="mt-1 text-sm text-slate-500">
          <Msg id="console.tables.printATableSQr" />
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900"><Msg id="console.tables.addATable" /></h2>
        <CreateTableForm
          tenantId={tenant.id}
          slug={slug}
          locale={locale}
          branches={(branches ?? []).map((b) => ({ id: b.id, name: branchNameById.get(b.id) ?? "" }))}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900"><Msg id="console.tables.yourTables" /></h2>
        {tablesWithQr.length > 0 ? (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="table-list">
            {tablesWithQr.map((t) => (
              <ManagedItem
                key={t.id}
                testId="table-row"
                title={tr("table", { label: t.label })}
                details={
                  <div className="flex flex-col items-start gap-2">
                    <span>{branchNameById.get(t.branch_id)}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated locally by the `qrcode` package, not a project asset */}
                    <img src={t.qrDataUrl} alt={tr("qrAlt", { label: t.label })} width={120} height={120} />
                  </div>
                }
                hidden={{ locale, slug, id: t.id }}
                fields={[{ name: "label", label: tAll("console.manage.label"), defaultValue: t.label, required: true, maxLength: 40 }]}
                update={updateTableAction}
                active={t.is_active}
                toggle={setTableActiveAction}
                remove={deleteTableAction}
                deleteConfirm={tAll("console.manage.deleteTable", { name: t.label })}
              />
            ))}
          </ul>
        ) : (
          <EmptyState title={tr("emptyTitle")} description={tr("emptyDescription")} />
        )}
      </section>
    </div>
  );
}
