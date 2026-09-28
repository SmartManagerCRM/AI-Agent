import { AddSourceForm } from "@/components/brain/add-source-form";
import { CreateEntryForm } from "@/components/brain/create-entry-form";
import { Button } from "@/components/console/button";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import {
  approveBrainEntryAction,
  archiveBrainEntryAction,
  recrawlSourceAction,
  rejectBrainEntryAction,
  resolveBrainConflictAction,
  toggleSourceActiveAction,
} from "@/server/brain/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-emerald-50 text-emerald-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-700",
};

const STATUS_STYLE: Record<string, string> = {
  pending_review: "bg-amber-50 text-amber-700",
  approved: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-700",
};

export default async function BusinessBrainPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: sources }, { data: entries }, { data: conflicts }] = await Promise.all([
    supabase.from("business_sources").select("*").order("created_at", { ascending: false }),
    supabase
      .from("business_brain_entries")
      .select("*")
      .in("status", ["pending_review", "approved", "rejected"])
      .order("created_at", { ascending: false }),
    supabase.from("business_brain_conflicts").select("*").eq("status", "open").order("created_at", { ascending: false }),
  ]);

  const pendingCount = (entries ?? []).filter((e) => e.status === "pending_review").length;
  const approvedCount = (entries ?? []).filter((e) => e.status === "approved").length;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Business Brain</h1>
        <p className="mt-1 text-sm text-slate-500">
          What your AI Agent knows about {tenant.business_name[locale] ?? tenant.slug} — from your website, documents, or entered by hand.
          Nothing from an outside source becomes active knowledge until you review and approve it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="branches" accent="emerald" label="Sources" value={String((sources ?? []).length)} trend={null} />
        <KpiTile icon="billing" accent="orange" label="Pending review" value={String(pendingCount)} trend={null} />
        <KpiTile icon="orders" accent="blue" label="Approved entries" value={String(approvedCount)} trend={null} />
        <KpiTile icon="conversations" accent="purple" label="Open conflicts" value={String((conflicts ?? []).length)} trend={null} />
      </div>

      {(conflicts ?? []).length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-amber-900">Conflicts to resolve</h2>
          <ul className="flex flex-col gap-3">
            {(conflicts ?? []).map((conflict) => (
              <li key={conflict.id} className="rounded-lg border border-amber-200 bg-white px-4 py-3 text-sm">
                <p className="font-medium capitalize text-slate-900">
                  {conflict.entry_type.replace("_", " ")} — {conflict.entry_key}
                </p>
                <p className="mt-1 text-xs text-slate-500">Two sources disagree. Pick which one is correct:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {conflict.conflicting_values.map((value, index) => (
                    <form key={index} action={resolveBrainConflictAction}>
                      <input type="hidden" name="conflictId" value={conflict.id} />
                      <input type="hidden" name="resolvedValueJson" value={JSON.stringify(value.value)} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-start text-xs hover:bg-slate-50"
                      >
                        <span className="block font-medium capitalize text-slate-900">{value.source_type.replace("_", " ")}</span>
                        <span className="block text-slate-600">{previewContent(value.value)}</span>
                      </button>
                    </form>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Website sources</h2>
        <AddSourceForm tenantId={tenant.id} slug={slug} locale={locale} />
        {(sources ?? []).length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {(sources ?? []).map((source) => (
              <li key={source.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">{source.url ?? "Manual entries"}</p>
                  <p className="text-slate-500">
                    <span className="capitalize">{source.status}</span>
                    {source.items_processed ? ` · ${source.items_processed} pages` : ""}
                    {source.error_message ? ` · ${source.error_message}` : ""}
                  </p>
                </div>
                {source.source_type === "website" && (
                  <div className="flex shrink-0 gap-2">
                    <form action={recrawlSourceAction}>
                      <input type="hidden" name="tenantId" value={tenant.id} />
                      <input type="hidden" name="sourceId" value={source.id} />
                      <input type="hidden" name="url" value={source.url ?? ""} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                        Recrawl
                      </button>
                    </form>
                    <form action={toggleSourceActiveAction}>
                      <input type="hidden" name="sourceId" value={source.id} />
                      <input type="hidden" name="isActive" value={String(!source.is_active)} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs font-medium text-slate-600 hover:underline">
                        {source.is_active ? "Disable" : "Enable"}
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3">
            <EmptyState title="No sources yet" description="Add your website above and SmartManager will start learning your business." />
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          A website is one of several ways to teach your Agent — Instagram, Facebook, PDF menus, and manual entry are coming as additional
          source types; every one lands here the same way for you to review.
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Add knowledge manually</h2>
        <CreateEntryForm tenantId={tenant.id} slug={slug} locale={locale} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Knowledge entries</h2>
        {(entries ?? []).length > 0 ? (
          <ul className="flex flex-col gap-3">
            {(entries ?? []).map((entry) => (
              <li key={entry.id} className="rounded-lg border border-slate-200 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium capitalize text-slate-900">{entry.entry_type.replace("_", " ")}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLE[entry.status] ?? "bg-slate-100 text-slate-500"}`}
                      >
                        {entry.status.replace("_", " ")}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${CONFIDENCE_STYLE[entry.confidence] ?? "bg-slate-100 text-slate-500"}`}
                      >
                        {entry.confidence} confidence
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-slate-600">{previewContent(entry.content)}</p>
                    <p className="mt-1.5 text-xs text-slate-400">
                      v{entry.version} · from {entry.source_type.replace("_", " ")}
                      {entry.last_verified_at && ` · verified ${new Date(entry.last_verified_at).toLocaleDateString(locale)}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    {entry.status === "pending_review" && (
                      <>
                        <form action={approveBrainEntryAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="locale" value={locale} />
                          <Button type="submit" variant="secondary" className="px-2 py-1 text-xs text-emerald-700">
                            Approve
                          </Button>
                        </form>
                        <form action={rejectBrainEntryAction}>
                          <input type="hidden" name="entryId" value={entry.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="locale" value={locale} />
                          <Button type="submit" variant="danger" className="px-2 py-1 text-xs">
                            Reject
                          </Button>
                        </form>
                      </>
                    )}
                    {entry.status === "approved" && (
                      <form action={archiveBrainEntryAction}>
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
                          Archive
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No knowledge yet" description="Add a website or an entry above and SmartManager AI Agent will build your Business Brain." />
        )}
      </section>
    </div>
  );
}

function previewContent(content: unknown): string {
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    const text = record.text ?? Object.values(record).find((v) => typeof v === "string");
    if (typeof text === "string") return text.length > 300 ? `${text.slice(0, 300)}…` : text;
    return JSON.stringify(content).slice(0, 300);
  }
  return String(content);
}
