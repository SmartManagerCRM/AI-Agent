import { InviteStaffForm } from "@/components/staff/invite-staff-form";
import { revokeInviteAction, setMemberStatusAction, updateMemberRoleAction } from "@/server/staff/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const ASSIGNABLE_ROLES = ["business_admin", "staff"] as const;

export default async function StaffPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: members }, { data: roles }, { data: invites }] = await Promise.all([
    supabase.from("tenant_members").select("id, user_id, role_id, status, created_at").eq("tenant_id", tenant.id).order("created_at"),
    supabase.from("roles").select("id, key, name").is("tenant_id", null),
    supabase
      .from("staff_invites")
      .select("id, email, role_key, status, expires_at, created_at")
      .eq("tenant_id", tenant.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  const roleById = new Map((roles ?? []).map((r) => [r.id, r]));
  const userIds = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <h1 className="text-2xl font-semibold">Staff</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Invite someone</h2>
        <InviteStaffForm tenantId={tenant.id} locale={locale} slug={slug} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-700">Team</h2>
        <table className="w-full text-start text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-neutral-500">
              <th className="py-2 text-start">Name</th>
              <th className="py-2 text-start">Email</th>
              <th className="py-2 text-start">Role</th>
              <th className="py-2 text-start">Status</th>
              <th className="py-2 text-start">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(members ?? []).map((member) => {
              const role = roleById.get(member.role_id);
              const profile = profileById.get(member.user_id);
              const isOwner = role?.key === "business_owner";
              return (
                <tr key={member.id} className="border-b border-neutral-100">
                  <td className="py-2">{profile?.full_name ?? "—"}</td>
                  <td className="py-2">{profile?.email ?? "—"}</td>
                  <td className="py-2 capitalize">{(role?.key ?? "").replace("_", " ")}</td>
                  <td className="py-2 capitalize">{member.status}</td>
                  <td className="py-2">
                    {!isOwner && (
                      <div className="flex flex-wrap items-center gap-2">
                        <form action={updateMemberRoleAction} className="flex items-center gap-1">
                          <input type="hidden" name="memberId" value={member.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="slug" value={slug} />
                          <select name="roleKey" defaultValue={role?.key} className="rounded-md border border-neutral-300 px-2 py-1 text-xs">
                            {ASSIGNABLE_ROLES.map((key) => (
                              <option key={key} value={key}>
                                {key.replace("_", " ")}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className="text-xs text-blue-700 underline">
                            Change
                          </button>
                        </form>
                        <form action={setMemberStatusAction}>
                          <input type="hidden" name="memberId" value={member.id} />
                          <input type="hidden" name="status" value={member.status === "active" ? "disabled" : "active"} />
                          <input type="hidden" name="locale" value={locale} />
                          <input type="hidden" name="slug" value={slug} />
                          <button type="submit" className="text-xs text-blue-700 underline">
                            {member.status === "active" ? "Disable" : "Re-enable"}
                          </button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {(invites ?? []).length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-neutral-700">Pending invites</h2>
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 text-start">Email</th>
                <th className="py-2 text-start">Role</th>
                <th className="py-2 text-start">Expires</th>
                <th className="py-2 text-start">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(invites ?? []).map((invite) => (
                <tr key={invite.id} className="border-b border-neutral-100">
                  <td className="py-2">{invite.email}</td>
                  <td className="py-2 capitalize">{invite.role_key.replace("_", " ")}</td>
                  <td className="py-2">{new Date(invite.expires_at).toLocaleDateString(locale)}</td>
                  <td className="py-2">
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="slug" value={slug} />
                      <button type="submit" className="text-xs text-red-700 underline">
                        Revoke
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
