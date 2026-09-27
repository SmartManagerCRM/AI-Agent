import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

/**
 * Read-only audit log (spec §98 Phase 8, `audit.read` — seeded since
 * Phase 1, never surfaced until now). RLS alone scopes this: the
 * `audit_logs_select` policy already requires `audit.read` or Super
 * Admin, so a signed-in tenant member without that permission simply sees
 * nothing here, no extra check needed in this page.
 */
export default async function AuditLogPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const { data: entries } = await supabase
    .from("audit_logs")
    .select("id, action, entity, entity_id, diff, at")
    .eq("tenant_id", tenant.id)
    .order("at", { ascending: false })
    .limit(100);

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">When</th>
            <th className="py-2 text-start">Action</th>
            <th className="py-2 text-start">Entity</th>
            <th className="py-2 text-start">Details</th>
          </tr>
        </thead>
        <tbody>
          {(entries ?? []).map((entry) => (
            <tr key={entry.id} className="border-b border-neutral-100 align-top">
              <td className="py-2 whitespace-nowrap">{new Date(entry.at).toLocaleString(locale)}</td>
              <td className="py-2">{entry.action}</td>
              <td className="py-2">{entry.entity}</td>
              <td className="py-2 font-mono text-xs text-neutral-500">{entry.diff ? JSON.stringify(entry.diff) : "—"}</td>
            </tr>
          ))}
          {(entries ?? []).length === 0 && (
            <tr>
              <td colSpan={4} className="py-4 text-center text-neutral-400">
                Nothing recorded yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
