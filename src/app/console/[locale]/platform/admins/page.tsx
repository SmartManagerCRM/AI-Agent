import { AddAdminForm } from "@/components/platform/add-admin-form";
import { removePlatformAdminAction } from "@/server/platform/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

export default async function PlatformAdminsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const { data: admins } = await supabase.from("platform_admins").select("user_id, level, created_at").order("created_at");
  const userIds = (admins ?? []).map((a) => a.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Super Admins</h1>

      <AddAdminForm locale={locale} />

      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">Name</th>
            <th className="py-2 text-start">Email</th>
            <th className="py-2 text-start">Level</th>
            <th className="py-2 text-start">Actions</th>
          </tr>
        </thead>
        <tbody>
          {(admins ?? []).map((admin) => {
            const profile = profileById.get(admin.user_id);
            return (
              <tr key={admin.user_id} className="border-b border-neutral-100">
                <td className="py-2">{profile?.full_name ?? "—"}</td>
                <td className="py-2">{profile?.email ?? "—"}</td>
                <td className="py-2 capitalize">{admin.level}</td>
                <td className="py-2">
                  <form action={removePlatformAdminAction}>
                    <input type="hidden" name="userId" value={admin.user_id} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="text-xs text-red-700 underline">
                      Remove
                    </button>
                  </form>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
