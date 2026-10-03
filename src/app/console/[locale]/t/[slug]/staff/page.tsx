import { InviteStaffForm } from "@/components/staff/invite-staff-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { revokeInviteAction, setMemberStatusAction, updateMemberRoleAction } from "@/server/staff/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";
import { statusLabel } from "@/lib/i18n-labels";

const ASSIGNABLE_ROLES = ["business_admin", "staff"] as const;

export default async function StaffPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const t = await getTranslations("console.staff");
  const tAll = await getTranslations();
  const roleName = (key: string) => (tAll.has(`common.role.${key}`) ? tAll(`common.role.${key}`) : key.replace("_", " "));

  const [{ data: members }, { data: roles }, { data: invites }] = await Promise.all([
    supabase
      .from("tenant_members")
      .select("id, user_id, role_id, status, created_at")
      .eq("tenant_id", tenant.id)
      .order("created_at"),
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
  const activeCount = (members ?? []).filter((m) => m.status === "active").length;

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <div className="grid grid-cols-3 gap-4">
        <KpiTile
          icon="staff"
          accent="emerald"
          label={t("teamMembers")}
          value={String((members ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/staff#team`}
        />
        <KpiTile icon="conversations" accent="blue" label={t("active")} value={String(activeCount)} trend={null} href={`/${locale}/${slug}/staff#team`} />
        <KpiTile
          icon="billing"
          accent="orange"
          label={t("pendingInvites")}
          value={String((invites ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/staff#${(invites ?? []).length > 0 ? "invites" : "invite"}`}
        />
      </div>

      <section id="invite" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("invite")}</h2>
        <InviteStaffForm tenantId={tenant.id} locale={locale} slug={slug} />
      </section>

      <section id="team" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("team")}</h2>
        {(members ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("name")}</th>
                  <th className="py-2 text-start font-medium">{t("email")}</th>
                  <th className="py-2 text-start font-medium">{t("role")}</th>
                  <th className="py-2 text-start font-medium">{t("status")}</th>
                  <th className="py-2 text-start font-medium">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(members ?? []).map((member) => {
                  const role = roleById.get(member.role_id);
                  const profile = profileById.get(member.user_id);
                  const isOwner = role?.key === "business_owner";
                  return (
                    <tr key={member.id} className="border-b border-slate-100 last:border-0">
                      <td className="py-2 font-medium text-slate-900">{profile?.full_name ?? "—"}</td>
                      <td className="py-2 text-slate-600">{profile?.email ?? "—"}</td>
                      <td className="py-2 text-slate-600">{roleName(role?.key ?? "")}</td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            member.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {statusLabel(tAll, member.status)}
                        </span>
                      </td>
                      <td className="py-2">
                        {!isOwner && (
                          <div className="flex flex-wrap items-center gap-3">
                            <form action={updateMemberRoleAction} className="flex items-center gap-1.5">
                              <input type="hidden" name="memberId" value={member.id} />
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="slug" value={slug} />
                              <select
                                name="roleKey"
                                defaultValue={role?.key}
                                className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                              >
                                {ASSIGNABLE_ROLES.map((key) => (
                                  <option key={key} value={key}>
                                    {roleName(key)}
                                  </option>
                                ))}
                              </select>
                              <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                                {t("change")}
                              </button>
                            </form>
                            <form action={setMemberStatusAction}>
                              <input type="hidden" name="memberId" value={member.id} />
                              <input
                                type="hidden"
                                name="status"
                                value={member.status === "active" ? "disabled" : "active"}
                              />
                              <input type="hidden" name="locale" value={locale} />
                              <input type="hidden" name="slug" value={slug} />
                              <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
                                {member.status === "active" ? t("disable") : t("reenable")}
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
          </div>
        ) : (
          <EmptyState title={t("emptyTitle")} description={t("emptyDescription")} />
        )}
      </section>

      {(invites ?? []).length > 0 && (
        <section id="invites" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("pendingInvites")}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 text-start font-medium">{t("email")}</th>
                  <th className="py-2 text-start font-medium">{t("role")}</th>
                  <th className="py-2 text-start font-medium">{t("expires")}</th>
                  <th className="py-2 text-start font-medium">{t("actions")}</th>
                </tr>
              </thead>
              <tbody>
                {(invites ?? []).map((invite) => (
                  <tr key={invite.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 text-slate-900">{invite.email}</td>
                    <td className="py-2 text-slate-600">{roleName(invite.role_key)}</td>
                    <td className="py-2 text-slate-600">{new Date(invite.expires_at).toLocaleDateString(locale)}</td>
                    <td className="py-2">
                      <form action={revokeInviteAction}>
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="slug" value={slug} />
                        <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                          {t("revoke")}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
