import { AddAdminForm } from "@/components/platform/add-admin-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { removePlatformAdminAction } from "@/server/platform/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

export default async function PlatformAdminsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const { data: admins } = await supabase
    .from("platform_admins")
    .select("user_id, level, created_at")
    .order("created_at");
  const userIds = (admins ?? []).map((a) => a.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Admin Users</h1>

      <KpiTile icon="shield" accent="emerald" label="Super Admins" value={String((admins ?? []).length)} trend={null} />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Add a Super Admin</h2>
        <AddAdminForm locale={locale} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Team</h2>
        {(admins ?? []).length > 0 ? (
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">Name</th>
                <th className="py-2 text-start font-medium">Email</th>
                <th className="py-2 text-start font-medium">Level</th>
                <th className="py-2 text-start font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(admins ?? []).map((admin) => {
                const profile = profileById.get(admin.user_id);
                return (
                  <tr key={admin.user_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{profile?.full_name ?? "—"}</td>
                    <td className="py-2 text-slate-600">{profile?.email ?? "—"}</td>
                    <td className="py-2 capitalize text-slate-600">{admin.level}</td>
                    <td className="py-2">
                      <form action={removePlatformAdminAction}>
                        <input type="hidden" name="userId" value={admin.user_id} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title="No Super Admins yet" description="Add one above." />
        )}
      </section>
    </div>
  );
}
