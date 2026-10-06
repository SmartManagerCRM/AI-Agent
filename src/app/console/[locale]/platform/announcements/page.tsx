import { EmptyState } from "@/components/console/empty-state";
import { AnnouncementRow } from "@/components/platform/announcement-row";
import { CreateAnnouncementForm } from "@/components/platform/create-announcement-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

/** Super Admin Master Spec — Announcements: a real, Super-Admin-authored broadcast shown in every tenant console while active. */
export default async function AnnouncementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const t = await getTranslations("platform.announcements");

  const { data: announcements } = await supabase
    .from("platform_announcements")
    .select("id, message, message_locale, message_translations, severity, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>
      <p className="-mt-4 text-sm text-slate-500">
        {t("subtitle")}
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("post")}</h2>
        <CreateAnnouncementForm locale={locale} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("all")}</h2>
        {(announcements ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            {(announcements ?? []).map((a) => (
              <AnnouncementRow
                key={a.id}
                locale={locale}
                announcement={{
                  id: a.id,
                  text: a.message_locale === locale ? a.message : (a.message_translations[locale] ?? a.message),
                  severity: a.severity === "warning" ? "warning" : "info",
                  isActive: a.is_active,
                  createdAt: a.created_at,
                  original: a.message_locale === locale,
                }}
              />
            ))}
          </div>
        ) : (
          <EmptyState title={t("empty")} description={t("emptyDescription")} />
        )}
      </section>
    </div>
  );
}
