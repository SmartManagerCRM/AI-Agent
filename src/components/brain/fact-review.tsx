import { Button } from "@/components/console/button";
import {
  approveBrainEntryAction,
  approveSafeSuggestionsAction,
  confirmFactWithEditAction,
  rejectBrainEntryAction,
} from "@/server/brain/actions";
import type { Database } from "@/types/database";

type Entry = Pick<
  Database["public"]["Tables"]["business_brain_entries"]["Row"],
  | "id"
  | "fact_key"
  | "entry_type"
  | "content"
  | "source_type"
  | "source_url"
  | "confidence_score"
  | "extraction_method"
  | "last_seen_at"
  | "expires_at"
>;

const GROUPS: { key: string; title: string; types: string[] }[] = [
  { key: "business", title: "Business details", types: ["identity", "business_type", "about"] },
  { key: "contact", title: "Contact & location", types: ["contact", "location"] },
  { key: "hours", title: "Opening hours & service options", types: ["hours", "capability"] },
  { key: "offerings", title: "Products & services", types: ["product_candidate", "service_candidate"] },
  { key: "policies", title: "Policies", types: ["policy"] },
  { key: "faq", title: "Frequently asked questions", types: ["faq"] },
];
const CRITICAL = new Set(["hours", "capability", "product_candidate", "service_candidate", "policy"]);
const MAX_PER_GROUP = 60;

const METHOD_LABEL: Record<string, string> = {
  structured_api: "Google Maps",
  structured_data: "Website (structured data)",
  deterministic: "Website",
  ai: "Website · read by AI — verify",
  inferred: "AI summary — verify",
  owner: "You",
};

function contentOf(entry: Entry): { display: string; normalized: unknown; question?: string; quote?: string } {
  const c = (entry.content ?? {}) as Record<string, unknown>;
  return {
    display: typeof c.display === "string" ? c.display : JSON.stringify(c).slice(0, 300),
    normalized: c.normalized,
    question: typeof c.question === "string" ? c.question : undefined,
    quote: typeof c.quote === "string" ? c.quote : undefined,
  };
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

/** Owner review of discovered facts: confirm, edit & confirm, or reject — with source, method and confidence shown for every value. */
export function FactReview({
  entries,
  conflictKeys,
  slug,
  locale,
  currency,
}: {
  entries: Entry[];
  conflictKeys: Set<string>;
  slug: string;
  locale: string;
  currency: string;
}) {
  if (entries.length === 0) return null;
  // One value per fact is approved in bulk (the same rule `approveSafeSuggestionsAction` applies).
  const safeCount = new Set(
    entries
      .filter(
        (e) =>
          (e.confidence_score ?? 0) >= 85 &&
          (e.extraction_method === "structured_api" || e.extraction_method === "structured_data") &&
          !CRITICAL.has(e.entry_type) &&
          !(e.fact_key && conflictKeys.has(e.fact_key)),
      )
      .map((e) => e.fact_key),
  ).size;
  const hasGoogle = entries.some((e) => e.source_type === "google_business");

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Review what we found ({entries.length})</h2>
          <p className="text-xs text-slate-500">
            Items marked <span className="font-medium text-amber-700">Check carefully</span> (prices, hours, policies, delivery) are never
            approved automatically.
          </p>
        </div>
        {safeCount > 0 && (
          <form action={approveSafeSuggestionsAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">
              Approve {safeCount} high-confidence detail{safeCount === 1 ? "" : "s"}
            </Button>
          </form>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {GROUPS.map((group) => {
          const items = entries.filter((e) => group.types.includes(e.entry_type));
          if (items.length === 0) return null;
          return (
            <div key={group.key}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {group.title} <span className="font-normal normal-case">({items.length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {items.slice(0, MAX_PER_GROUP).map((entry) => (
                  <FactRow
                    key={entry.id}
                    entry={entry}
                    conflicted={Boolean(entry.fact_key && conflictKeys.has(entry.fact_key))}
                    slug={slug}
                    locale={locale}
                    currency={currency}
                  />
                ))}
              </ul>
              {items.length > MAX_PER_GROUP && (
                <p className="mt-2 text-xs text-slate-500">
                  {items.length - MAX_PER_GROUP} more — confirm or reject these first to see the rest.
                </p>
              )}
            </div>
          );
        })}
      </div>
      {hasGoogle && (
        <p className="mt-4 text-xs text-slate-400">
          Some details are from Google Maps. Unconfirmed Google details are removed automatically after 30 days.
        </p>
      )}
    </section>
  );
}

function FactRow({ entry, conflicted, slug, locale, currency }: { entry: Entry; conflicted: boolean; slug: string; locale: string; currency: string }) {
  const c = contentOf(entry);
  const critical = CRITICAL.has(entry.entry_type);
  const isOffering = entry.entry_type === "product_candidate" || entry.entry_type === "service_candidate";
  const offering = isOffering ? ((c.normalized ?? {}) as { name?: string; amount?: string | null }) : null;
  const expiresIn = daysUntil(entry.expires_at);
  const editable = entry.entry_type !== "hours" && entry.entry_type !== "capability" && entry.entry_type !== "business_type";

  return (
    <li className={`rounded-lg border px-3 py-2.5 text-sm ${conflicted ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {c.question && <p className="font-medium text-slate-900">{c.question}</p>}
          <p className="whitespace-pre-wrap break-words text-slate-800" dir="auto">
            {c.display.length > 400 ? `${c.display.slice(0, 400)}…` : c.display}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>{METHOD_LABEL[entry.extraction_method ?? ""] ?? entry.source_type.replace(/_/g, " ")}</span>
            {entry.confidence_score !== null && <span>· {entry.confidence_score}% confidence</span>}
            {entry.source_url && (
              <a href={entry.source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-emerald-700 hover:underline">
                · source
              </a>
            )}
            {entry.last_seen_at && <span>· seen {new Date(entry.last_seen_at).toLocaleDateString(locale)}</span>}
            {expiresIn !== null && <span>· expires in {expiresIn}d unless confirmed</span>}
            {critical && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">Check carefully</span>}
            {conflicted && <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700">Sources disagree</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <form action={approveBrainEntryAction}>
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="secondary" className="px-2 py-1 text-xs text-emerald-700">
              {conflicted ? "Use this" : "Confirm"}
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
        </div>
      </div>
      {editable && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">Edit &amp; confirm</summary>
          <form action={confirmFactWithEditAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            {offering ? (
              <>
                <label className="flex flex-col gap-1 text-xs">
                  Name
                  <input name="name" defaultValue={offering.name ?? ""} required maxLength={160} className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Price ({currency})
                  <input name="amount" defaultValue={offering.amount ?? ""} inputMode="decimal" placeholder="Leave empty if unknown" className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm" />
                </label>
              </>
            ) : (
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs">
                Correct value
                <textarea name="value" defaultValue={c.display} required maxLength={4000} rows={2} className="rounded-md border border-slate-300 px-2 py-1 text-sm" dir="auto" />
              </label>
            )}
            <Button type="submit" className="px-3 py-1.5 text-xs">
              Save &amp; confirm
            </Button>
          </form>
        </details>
      )}
      {entry.entry_type === "hours" && (
        <p className="mt-1 text-xs text-slate-500">Hours set on your branch (in Branches) always take priority over these.</p>
      )}
    </li>
  );
}
