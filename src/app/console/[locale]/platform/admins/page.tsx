import { AddAdminForm } from "@/components/platform/add-admin-form";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { removePlatformAdminAction } from "@/server/platform/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

export default async function PlatformAdminsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.admins");

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
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <KpiTile icon="shield" accent="emerald" label={t("count")} value={String((admins ?? []).length)} trend={null} href={`/${locale}/super-admin/admins#team`} />

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("add")}</h2>
        <AddAdminForm locale={locale} />
      </section>

      <section id="team" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("team")}</h2>
        {(admins ?? []).length > 0 ? (
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">{t("col.name")}</th>
                <th className="py-2 text-start font-medium">{t("col.email")}</th>
                <th className="py-2 text-start font-medium">{t("col.level")}</th>
                <th className="py-2 text-start font-medium">{t("col.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {(admins ?? []).map((admin) => {
                const profile = profileById.get(admin.user_id);
                return (
                  <tr key={admin.user_id} className="border-b border-slate-100 last:border-0">
                    <td className="py-2 font-medium text-slate-900">{profile?.full_name ?? "—"}</td>
                    <td className="py-2 text-slate-600">{profile?.email ?? "—"}</td>
                    <td className="py-2 text-slate-600">{t.has(`level.${admin.level}`) ? t(`level.${admin.level}`) : admin.level}</td>
                    <td className="py-2">
                      <form action={removePlatformAdminAction}>
                        <input type="hidden" name="userId" value={admin.user_id} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs font-medium text-red-600 hover:underline">
                          {t("remove")}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState title={t("empty")} description={t("emptyDescription")} />
        )}
      </section>
    </div>
  );
}
