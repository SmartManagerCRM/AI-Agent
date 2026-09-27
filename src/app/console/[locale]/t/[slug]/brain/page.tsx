import { AddSourceForm } from "@/components/brain/add-source-form";
import { CreateEntryForm } from "@/components/brain/create-entry-form";
import {
  approveBrainEntryAction,
  archiveBrainEntryAction,
  recrawlSourceAction,
  rejectBrainEntryAction,
  toggleSourceActiveAction,
} from "@/server/brain/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function BusinessBrainPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const [{ data: sources }, { data: entries }] = await Promise.all([
    supabase.from("business_sources").select("*").order("created_at", { ascending: false }),
    supabase
      .from("business_brain_entries")
      .select("*")
      .in("status", ["pending_review", "approved", "rejected"])
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-10">
      <div>
        <h1 className="text-2xl font-semibold">Business Brain</h1>
        <p className="mt-1 text-sm text-neutral-500">
          What your AI Agent knows about {tenant.business_name[locale] ?? tenant.slug}. Crawled content is never
          trusted automatically — review and approve it below before it becomes active knowledge.
        </p>
      </div>

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
                  {source.pages_crawled ? ` · ${source.pages_crawled} pages` : ""}
                  {source.error_message ? ` · ${source.error_message}` : ""}
                </p>
              </div>
              {source.kind === "website" && (
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
                    {entry.status} · from {entry.source}
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
