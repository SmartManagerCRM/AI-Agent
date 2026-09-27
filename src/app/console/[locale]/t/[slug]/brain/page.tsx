import { AddSourceForm } from "@/components/brain/add-source-form";
import { CreateEntryForm } from "@/components/brain/create-entry-form";
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

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Business Brain</h1>
        <p className="mt-1 text-sm text-neutral-500">
          What your AI Agent knows about {tenant.business_name[locale] ?? tenant.slug} — from your website, documents,
          or entered by hand. Nothing from an outside source becomes active knowledge until you review and approve it.
        </p>
      </div>

      {(conflicts ?? []).length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-neutral-700">Conflicts to resolve</h2>
          <ul className="flex flex-col gap-3">
            {(conflicts ?? []).map((conflict) => (
              <li key={conflict.id} className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm">
                <p className="font-medium capitalize">
                  {conflict.entry_type.replace("_", " ")} — {conflict.entry_key}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Two sources disagree. Pick which one is correct:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {conflict.conflicting_values.map((value, index) => (
                    <form key={index} action={resolveBrainConflictAction}>
                      <input type="hidden" name="conflictId" value={conflict.id} />
                      <input type="hidden" name="resolvedValueJson" value={JSON.stringify(value.value)} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        className="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-start text-xs hover:bg-neutral-50"
                      >
                        <span className="block font-medium capitalize">{value.source_type.replace("_", " ")}</span>
                        <span className="block text-neutral-600">{previewContent(value.value)}</span>
                      </button>
                    </form>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-neutral-700">Website sources</h2>
        <AddSourceForm tenantId={tenant.id} slug={slug} locale={locale} />
        <ul className="flex flex-col gap-2">
          {(sources ?? []).map((source) => (
            <li key={source.id} className="flex items-center justify-between rounded-md border border-neutral-200 px-4 py-3 text-sm">
              <div>
                <p className="font-medium">{source.url ?? "Manual entries"}</p>
                <p className="text-neutral-500">
                  {source.status}
                  {source.items_processed ? ` · ${source.items_processed} pages` : ""}
                  {source.error_message ? ` · ${source.error_message}` : ""}
                </p>
              </div>
              {source.source_type === "website" && (
                <div className="flex gap-2">
                  <form action={recrawlSourceAction}>
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <input type="hidden" name="sourceId" value={source.id} />
                    <input type="hidden" name="url" value={source.url ?? ""} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="text-neutral-600 underline">
                      Recrawl
                    </button>
                  </form>
                  <form action={toggleSourceActiveAction}>
                    <input type="hidden" name="sourceId" value={source.id} />
                    <input type="hidden" name="isActive" value={String(!source.is_active)} />
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="locale" value={locale} />
                    <button type="submit" className="text-neutral-600 underline">
                      {source.is_active ? "Disable" : "Enable"}
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
          {(sources ?? []).length === 0 && <p className="text-sm text-neutral-400">No sources yet.</p>}
        </ul>
        <p className="text-xs text-neutral-400">
          A website is one of several ways to teach your Agent — Instagram, Facebook, PDF menus, and manual entry are
          coming as additional source types; every one lands here the same way for you to review.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-neutral-700">Add knowledge manually</h2>
        <CreateEntryForm tenantId={tenant.id} slug={slug} locale={locale} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold text-neutral-700">Knowledge entries</h2>
        <ul className="flex flex-col gap-2">
          {(entries ?? []).map((entry) => (
            <li key={entry.id} className="rounded-md border border-neutral-200 px-4 py-3 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium capitalize">
                    {entry.entry_type.replace("_", " ")} <span className="text-neutral-400">· v{entry.version}</span>
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-neutral-600">{previewContent(entry.content)}</p>
                  <p className="mt-1 text-xs text-neutral-400">
                    {entry.status} · from {entry.source_type.replace("_", " ")} · {entry.confidence} confidence
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {entry.status === "pending_review" && (
                    <>
                      <form action={approveBrainEntryAction}>
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-emerald-700 underline">
                          Approve
                        </button>
                      </form>
                      <form action={rejectBrainEntryAction}>
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="locale" value={locale} />
                        <button type="submit" className="text-red-600 underline">
                          Reject
                        </button>
                      </form>
                    </>
                  )}
                  {entry.status === "approved" && (
                    <form action={archiveBrainEntryAction}>
                      <input type="hidden" name="entryId" value={entry.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-neutral-500 underline">
                        Archive
                      </button>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
          {(entries ?? []).length === 0 && <p className="text-sm text-neutral-400">Nothing yet — add a website or an entry above.</p>}
        </ul>
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
