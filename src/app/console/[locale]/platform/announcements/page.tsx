import { EmptyState } from "@/components/console/empty-state";
import { CreateAnnouncementForm } from "@/components/platform/create-announcement-form";
import { setAnnouncementActiveAction } from "@/server/platform/announcement-actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** Super Admin Master Spec — Announcements: a real, Super-Admin-authored broadcast shown in every tenant console while active. */
export default async function AnnouncementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const { data: announcements } = await supabase
    .from("platform_announcements")
    .select("id, message, severity, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Announcements</h1>
      <p className="-mt-4 text-sm text-slate-500">
        Shown as a banner in every business&apos;s console while active — nothing here is emailed or pushed.
      </p>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Post an announcement</h2>
        <CreateAnnouncementForm locale={locale} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">All announcements</h2>
        {(announcements ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            {(announcements ?? []).map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-100 p-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="text-slate-900">{a.message}</p>
                  <p className="text-xs text-slate-400">
                    {a.severity} · {new Date(a.created_at).toLocaleString(locale)}
                  </p>
                </div>
                <form action={setAnnouncementActiveAction}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="value" value={(!a.is_active).toString()} />
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" className="shrink-0 text-xs font-medium text-emerald-600 hover:underline">
                    {a.is_active ? "Active" : "Inactive"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No announcements yet" description="Post one above to broadcast it to every business." />
        )}
      </section>
    </div>
  );
}
