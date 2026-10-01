import { GoLivePanel } from "@/components/agent/go-live-panel";
import { CreateEntryForm } from "@/components/brain/create-entry-form";
import { DiscoveryPanel } from "@/components/brain/discovery-panel";
import { FactReview } from "@/components/brain/fact-review";
import { ReadinessCard } from "@/components/brain/readiness-card";
import { Button } from "@/components/console/button";
import { EmptyState } from "@/components/console/empty-state";
import { KpiTile } from "@/components/console/kpi-tile";
import { Pagination, parsePage } from "@/components/console/pagination";
import {
  approveBrainEntryAction,
  archiveBrainEntryAction,
  recrawlSourceAction,
  rejectBrainEntryAction,
  resolveBrainConflictAction,
  toggleSourceActiveAction,
} from "@/server/brain/actions";
import { loadGoLive } from "@/server/agent-public/go-live";
import { placesConfigured } from "@/server/brain/discovery/google-places";
import { loadReadiness } from "@/server/brain/discovery/pipeline";
import { timed } from "@/server/perf";
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

/** Knowledge entries are large cards (content preview + actions) — 25 per page. */
const PAGE_SIZE = 25;
const LISTED_STATUSES = ["pending_review", "approved", "rejected"] as const;
const RUNNING_JOB = [
  "created",
  "discovering",
  "fetching",
  "extracting",
  "ai_processing",
  "normalizing",
  "validating",
  "conflict_check",
] as const;
const JOB_STATUS_STYLE: Record<string, string> = {
  ready_for_review: "bg-amber-50 text-amber-700",
  completed: "bg-emerald-50 text-emerald-700",
  failed: "bg-red-50 text-red-700",
  paused: "bg-amber-50 text-amber-700",
  cancelled: "bg-slate-100 text-slate-500",
};
const SOURCE_LABEL: Record<string, string> = {
  google_business: "Google Maps listing",
  website: "Website",
  online_menu: "Menu source",
  online_ordering: "Online ordering",
  image: "Menu image",
  manual: "You",
};

export default async function BusinessBrainPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale, slug } = await params;
  const page = parsePage((await searchParams).page);
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();

  const countEntries = () =>
    supabase.from("business_brain_entries").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id);
  const from = (page - 1) * PAGE_SIZE;
  const [
    { data: sources },
    { data: entries, count: listedCount },
    { data: conflicts },
    { count: pendingCount },
    { count: approvedCount },
    { data: suggestions },
    { data: jobs },
    readiness,
    goLive,
  ] = await timed(
    "brain.queries",
    Promise.all([
      supabase
        .from("business_sources")
        .select("*")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("business_brain_entries")
        .select("*", { count: "exact" })
        .eq("tenant_id", tenant.id)
        .in("status", LISTED_STATUSES)
        // Discovered suggestions awaiting review are listed in "Review what we found" instead.
        .or("fact_key.is.null,status.neq.pending_review")
        .order("created_at", { ascending: false })
        .order("id")
        .range(from, from + PAGE_SIZE - 1),
      supabase
        .from("business_brain_conflicts")
        .select("*")
        .eq("tenant_id", tenant.id)
        .eq("status", "open")
        .order("created_at", { ascending: false }),
      countEntries().eq("status", "pending_review"),
      countEntries().eq("status", "approved"),
      supabase
        .from("business_brain_entries")
        .select(
          "id, fact_key, entry_type, content, source_type, source_url, confidence_score, extraction_method, last_seen_at, expires_at",
        )
        .eq("tenant_id", tenant.id)
        .eq("status", "pending_review")
        .not("fact_key", "is", null)
        .order("entry_type")
        .order("confidence_score", { ascending: false })
        .limit(500),
      supabase
        .from("brain_ingestion_jobs")
        .select("id, status, status_reason, input, created_at, pages_processed, facts_proposed, conflicts_detected")
        .eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false })
        .limit(5),
      loadReadiness(supabase, tenant.id),
      loadGoLive(supabase, tenant, locale),
    ]),
  );
  const activeJob = (jobs ?? []).find((j) => (RUNNING_JOB as readonly string[]).includes(j.status)) ?? null;
  const lastInput = ((jobs ?? [])[0]?.input ?? {}) as {
    mapsInput?: string | null;
    websiteUrl?: string | null;
    menuUrls?: string[] | null;
  };
  const conflictKeys = new Set((conflicts ?? []).map((c) => c.entry_key));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Business Brain</h1>
        <p className="mt-1 text-sm text-slate-500">
          What your AI Agent knows about {tenant.business_name[locale] ?? tenant.slug} — from your website, documents,
          or entered by hand. Nothing from an outside source becomes active knowledge until you review and approve it.
        </p>
      </div>

      <DiscoveryPanel
        slug={slug}
        locale={locale}
        placesAvailable={placesConfigured()}
        defaults={{
          mapsInput: lastInput.mapsInput ?? "",
          websiteUrl: lastInput.websiteUrl ?? tenant.website_url ?? "",
          menuUrls: (lastInput.menuUrls ?? []).join("\n"),
        }}
        activeJobId={activeJob?.id ?? null}
        hasRunBefore={(jobs ?? []).length > 0}
        isLive={goLive.isLive}
      />

      <ReadinessCard readiness={readiness} />

      <GoLivePanel state={goLive} slug={slug} locale={locale} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiTile icon="branches" accent="emerald" label="Sources" value={String((sources ?? []).length)} trend={null} href={`/${locale}/${slug}/brain#sources`} />
        <KpiTile icon="billing" accent="orange" label="Pending review" value={String(pendingCount ?? 0)} trend={null} href={`/${locale}/${slug}/brain#knowledge`} />
        <KpiTile icon="orders" accent="blue" label="Approved entries" value={String(approvedCount ?? 0)} trend={null} href={`/${locale}/${slug}/brain#knowledge`} />
        <KpiTile
          icon="conversations"
          accent="purple"
          label="Open conflicts"
          value={String((conflicts ?? []).length)}
          trend={null}
          href={`/${locale}/${slug}/brain#conflicts`}
        />
      </div>

      {(conflicts ?? []).length > 0 && (
        <section id="conflicts" className="scroll-mt-20 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <h2 className="mb-3 text-sm font-semibold text-amber-900">Conflicts to resolve</h2>
          <ul className="flex flex-col gap-3">
            {(conflicts ?? []).map((conflict) => (
              <li key={conflict.id} className="rounded-lg border border-amber-200 bg-white px-4 py-3 text-sm">
                <p className="font-medium text-slate-900">
                  {conflictTitle(conflict.entry_type, conflict.entry_key, conflict.conflicting_values[0]?.value)}
                </p>
                <p className="mt-1 text-xs text-slate-500">Two sources disagree. Pick which one is correct:</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {conflict.conflicting_values.map((value, index) => (
                    <form key={index} action={value.entry_id ? approveBrainEntryAction : resolveBrainConflictAction}>
                      {value.entry_id ? (
                        <input type="hidden" name="entryId" value={value.entry_id} />
                      ) : (
                        <>
                          <input type="hidden" name="conflictId" value={conflict.id} />
                          <input type="hidden" name="resolvedValueJson" value={JSON.stringify(value.value)} />
                        </>
                      )}
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-start text-xs hover:bg-slate-50"
                      >
                        <span className="block font-medium text-slate-900">
                          {SOURCE_LABEL[value.source_type] ?? value.source_type.replace("_", " ")}
                          {typeof value.confidence_score === "number" && (
                            <span className="font-normal text-slate-500"> · {value.confidence_score}%</span>
                          )}
                        </span>
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

      <FactReview
        entries={suggestions ?? []}
        conflictKeys={conflictKeys}
        slug={slug}
        locale={locale}
        currency={tenant.currency}
      />

      <section id="sources" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Sources</h2>
        {(sources ?? []).length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {(sources ?? []).map((source) => (
              <li
                key={source.id}
                className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-slate-900">
                    {SOURCE_LABEL[source.source_type] ?? source.source_type.replace("_", " ")}
                    {source.url && <span className="font-normal text-slate-500"> · {source.url}</span>}
                  </p>
                  <p className="text-slate-500">
                    <span className="capitalize">{source.processing_status.replace("_", " ")}</span>
                    {source.source_type === "website" && source.items_processed
                      ? ` · ${source.items_processed} pages`
                      : ""}
                    {source.last_scanned_at
                      ? ` · checked ${new Date(source.last_scanned_at).toLocaleDateString(locale)}`
                      : ""}
                    {source.error_message ? ` · ${source.error_message}` : ""}
                  </p>
                  {source.source_type === "online_menu" && source.metrics && (
                    <MenuSourceSummary metrics={source.metrics as MenuMetrics} />
                  )}
                </div>
                {(source.source_type === "website" || source.source_type === "online_menu") && (
                  <div className="flex shrink-0 gap-2">
                    <form action={recrawlSourceAction}>
                      <input type="hidden" name="url" value={source.url ?? ""} />
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                        Rescan
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
            <EmptyState
              title="No sources yet"
              description="Analyze your Google Maps listing or website above, or add knowledge by hand below."
            />
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Google Maps and your website are read today; PDF menus, images and social pages are planned as additional
          source types — every one lands here the same way for you to review.
        </p>
        {(jobs ?? []).length > 0 && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-700">Recent analyses</p>
            <ul className="flex flex-col gap-1 text-xs text-slate-600">
              {(jobs ?? []).map((job) => (
                <li key={job.id} className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium capitalize ${JOB_STATUS_STYLE[job.status] ?? "bg-blue-50 text-blue-700"}`}
                  >
                    {job.status.replace(/_/g, " ")}
                  </span>
                  <span>{new Date(job.created_at).toLocaleString(locale)}</span>
                  <span>
                    · {job.pages_processed} page(s) · {job.facts_proposed} new fact(s)
                    {job.conflicts_detected ? ` · ${job.conflicts_detected} conflict(s)` : ""}
                  </span>
                  {job.status_reason && <span className="text-slate-500">· {job.status_reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Add knowledge manually</h2>
        <CreateEntryForm tenantId={tenant.id} slug={slug} locale={locale} />
      </section>

      <section id="knowledge" className="scroll-mt-20 rounded-xl border border-slate-200 bg-white p-4">
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
                      {entry.last_verified_at &&
                        ` · verified ${new Date(entry.last_verified_at).toLocaleDateString(locale)}`}
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
          <EmptyState
            title="No knowledge yet"
            description="Add a website or an entry above and SmartManager AI Agent will build your Business Brain."
          />
        )}
        {((listedCount ?? 0) > PAGE_SIZE || page > 1) && (
          <div className="-mx-4 -mb-4 mt-4">
            <Pagination
              basePath={`/${locale}/${slug}/brain`}
              params={{}}
              page={page}
              pageSize={PAGE_SIZE}
              total={listedCount ?? 0}
            />
          </div>
        )}
      </section>
    </div>
  );
}

type MenuMetrics = {
  kind?: string;
  images_detected?: number;
  menu_images?: number;
  images_processed?: number;
  images_unchanged?: number;
  images_failed?: number;
  products?: number;
  categories?: number;
  prices?: number;
  descriptions?: number;
  extraction?: { html?: boolean; ocr?: boolean; vision?: boolean };
  related_pages?: { url: string; kind: string }[];
  ordering?: { url: string; status: string; reason: string | null }[];
};

/** Menu source analysis at a glance (spec: images detected/processed, products, categories, prices, descriptions, methods). */
function MenuSourceSummary({ metrics: m }: { metrics: MenuMetrics }) {
  const figures: [string, number | undefined][] = [
    ["Images detected", m.images_detected],
    ["Menu images processed", m.images_processed],
    ["Products detected", m.products],
    ["Categories", m.categories],
    ["Prices", m.prices],
    ["Descriptions", m.descriptions],
  ];
  const check = (on: boolean | undefined, label: string) => (
    <span className={on ? "text-emerald-700" : "text-slate-400"}>
      {on ? "✓" : "–"} {label}
    </span>
  );
  return (
    <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      <p className="font-medium text-slate-800">
        ✓ Direct link analyzed{m.kind ? ` · ${m.kind.replace(/_/g, " ").toLowerCase()}` : ""}
      </p>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
        {figures.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-2">
            <dt>{label}</dt>
            <dd className="font-semibold text-slate-900">{value ?? 0}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 flex flex-wrap gap-3">
        Extraction: {check(m.extraction?.html, "HTML")} {check(m.extraction?.ocr, "OCR")}{" "}
        {check(m.extraction?.vision, "Vision")}
        {m.images_unchanged ? <span>· {m.images_unchanged} image(s) unchanged, skipped</span> : null}
        {m.images_failed ? <span className="text-amber-700">· {m.images_failed} image(s) not readable</span> : null}
      </p>
      {(m.related_pages?.length ?? 0) > 0 && (
        <p className="mt-1">Related pages read: {m.related_pages!.map((r) => new URL(r.url).pathname).join(", ")}</p>
      )}
      {(m.ordering ?? []).map((o) => (
        <p key={o.url} className={`mt-1 ${o.status === "read" ? "" : "text-amber-700"}`}>
          Online ordering: {o.url} — {o.status === "read" ? "read" : `not read (${o.reason})`}
        </p>
      ))}
      <a
        href="#review-products"
        className="mt-2 inline-block rounded-md bg-emerald-600 px-3 py-1.5 font-medium text-white hover:bg-emerald-500"
      >
        Review products
      </a>
    </div>
  );
}

const FACT_TITLE: Record<string, string> = {
  "hours.regular": "Opening hours",
  "hours.note": "Opening hours note",
  "identity.operational_status": "Open / closed status",
  "contact.phone": "Phone number",
  "location.address": "Address",
};

function conflictTitle(entryType: string, entryKey: string, sample?: unknown): string {
  if (FACT_TITLE[entryKey]) return FACT_TITLE[entryKey];
  const productName = (sample as { normalized?: { name?: unknown } } | undefined)?.normalized?.name;
  if (entryKey.startsWith("offering:") && typeof productName === "string") return `${productName} — price`;
  const type = entryType.replace(/_/g, " ");
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  if (entryKey.startsWith("offering:")) return `${label} — price`;
  if (/^[a-z_]+\.[a-z_]+$/.test(entryKey)) return `${label} — ${entryKey.split(".")[1].replace(/_/g, " ")}`;
  return `${label} — ${entryKey}`;
}

function previewContent(content: unknown): string {
  if (content && typeof content === "object") {
    const record = content as Record<string, unknown>;
    const text = record.display ?? record.text ?? Object.values(record).find((v) => typeof v === "string");
    if (typeof text === "string") return text.length > 300 ? `${text.slice(0, 300)}…` : text;
    return JSON.stringify(content).slice(0, 300);
  }
  return String(content);
}
