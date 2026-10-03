import { useTranslations } from "next-intl";

import { Button } from "@/components/console/button";
import { RichMsg } from "@/components/i18n/msg";
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

const GROUPS: { key: string; types: string[] }[] = [
  { key: "business", types: ["identity", "business_type", "about"] },
  { key: "contact", types: ["contact", "location"] },
  { key: "hours", types: ["hours", "capability"] },
  { key: "offerings", types: ["product_candidate", "service_candidate"] },
  { key: "policies", types: ["policy"] },
  { key: "faq", types: ["faq"] },
];
const CRITICAL = new Set(["hours", "capability", "product_candidate", "service_candidate", "policy"]);
const MAX_PER_GROUP = 60;

type T = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };

function contentOf(entry: Entry): {
  display: string;
  normalized: unknown;
  question?: string;
  quote?: string;
  imageUrl?: string;
  category?: string;
  secondaryName?: string;
} {
  const c = (entry.content ?? {}) as Record<string, unknown>;
  const text = (k: string) => (typeof c[k] === "string" && c[k] ? (c[k] as string) : undefined);
  return {
    display: typeof c.display === "string" ? c.display : JSON.stringify(c).slice(0, 300),
    normalized: c.normalized,
    question: text("question"),
    quote: text("quote"),
    imageUrl: text("source_image_url"),
    category: text("category"),
    secondaryName: text("secondary_name"),
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
  const t = useTranslations("console.factReview");
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
          <h2 className="text-sm font-semibold text-slate-900">
            {t("title", { count: new Set(entries.map((e) => e.fact_key ?? e.id)).size })}
          </h2>
          <p className="text-xs text-slate-500">
            <RichMsg id="console.factReview.hint" values={{ mark: (chunks) => <span className="font-medium text-amber-700">{chunks}</span> }} />
          </p>
        </div>
        {safeCount > 0 && (
          <form action={approveSafeSuggestionsAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="secondary" className="px-3 py-1.5 text-xs">
              {t("approveSafe", { count: safeCount })}
            </Button>
          </form>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-4">
        {GROUPS.map((group) => {
          const clusters = clusterByFact(
            entries.filter((e) => group.types.includes(e.entry_type)),
            conflictKeys,
          );
          if (clusters.length === 0) return null;
          return (
            <div
              key={group.key}
              id={group.key === "offerings" ? "review-products" : undefined}
              className="scroll-mt-20"
            >
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {t(`group.${group.key}`)} <span className="font-normal normal-case">({clusters.length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {clusters.slice(0, MAX_PER_GROUP).flatMap((cluster) =>
                  cluster.conflicted
                    ? // Sources disagree: every candidate is shown, the owner picks one.
                      cluster.entries.map((entry) => (
                        <FactRow
                          key={entry.id}
                          entry={entry}
                          conflicted
                          slug={slug}
                          locale={locale}
                          currency={currency}
                        />
                      ))
                    : [
                        <FactRow
                          key={cluster.entries[0].id}
                          entry={cluster.entries[0]}
                          conflicted={false}
                          alsoSeen={cluster.entries.slice(1)}
                          slug={slug}
                          locale={locale}
                          currency={currency}
                        />,
                      ],
                )}
              </ul>
              {clusters.length > MAX_PER_GROUP && (
                <p className="mt-2 text-xs text-slate-500">
                  {t("more", { n: clusters.length - MAX_PER_GROUP })}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {hasGoogle && (
        <p className="mt-4 text-xs text-slate-400">
          {t("googleNote")}
        </p>
      )}
    </section>
  );
}

/**
 * One review row per fact: the same product found on the menu image, the
 * menu page and the ordering page is ONE product. Its most authoritative
 * candidate (highest confidence, a price over no price) is shown, the
 * other sources listed under it; confirming it closes the others.
 */
function clusterByFact(items: Entry[], conflictKeys: Set<string>): { entries: Entry[]; conflicted: boolean }[] {
  const byKey = new Map<string, Entry[]>();
  for (const e of items) {
    const k = e.fact_key ?? e.id;
    byKey.set(k, [...(byKey.get(k) ?? []), e]);
  }
  const priced = (e: Entry) =>
    Boolean(((e.content as { normalized?: { amount?: unknown } } | null)?.normalized ?? {}).amount);
  return [...byKey.entries()].map(([key, list]) => ({
    conflicted: conflictKeys.has(key),
    entries: [...list].sort(
      (a, b) => Number(priced(b)) - Number(priced(a)) || (b.confidence_score ?? 0) - (a.confidence_score ?? 0),
    ),
  }));
}

const sourceName = (t: T, sourceType: string) => (t.has(`source.${sourceType}`) ? t(`source.${sourceType}`) : sourceType.replace(/_/g, " "));

function sourceLabel(t: T, entry: Entry): string {
  if (entry.source_type === "online_ordering" || entry.source_type === "online_menu") {
    const base = sourceName(t, entry.source_type);
    return entry.extraction_method === "ai" ? t("readByAi", { source: base }) : base;
  }
  const method = `method.${entry.extraction_method ?? ""}`;
  return t.has(method) ? t(method) : entry.source_type.replace(/_/g, " ");
}

function FactRow({
  entry,
  conflicted,
  alsoSeen = [],
  slug,
  locale,
  currency,
}: {
  entry: Entry;
  conflicted: boolean;
  alsoSeen?: Entry[];
  slug: string;
  locale: string;
  currency: string;
}) {
  const t = useTranslations("console.factReview");
  const c = contentOf(entry);
  const critical = CRITICAL.has(entry.entry_type);
  const isOffering = entry.entry_type === "product_candidate" || entry.entry_type === "service_candidate";
  const offering = isOffering ? ((c.normalized ?? {}) as { name?: string; amount?: string | null }) : null;
  const expiresIn = daysUntil(entry.expires_at);
  const editable =
    entry.entry_type !== "hours" && entry.entry_type !== "capability" && entry.entry_type !== "business_type";

  return (
    <li
      className={`rounded-lg border px-3 py-2.5 text-sm ${conflicted ? "border-red-200 bg-red-50/40" : "border-slate-200"}`}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {c.question && <p className="font-medium text-slate-900">{c.question}</p>}
          {c.secondaryName && (
            <p className="text-xs text-slate-500" dir="auto">
              {c.secondaryName}
            </p>
          )}
          <p className="whitespace-pre-wrap break-words text-slate-800" dir="auto">
            {c.display.length > 400 ? `${c.display.slice(0, 400)}…` : c.display}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
            <span>{sourceLabel(t, entry)}</span>
            {entry.confidence_score !== null && <span>{t("confidence", { n: entry.confidence_score })}</span>}
            {c.category && <span>· {c.category}</span>}
            {entry.source_url && (
              <a
                href={entry.source_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-emerald-700 hover:underline"
              >
                {t("sourceLink")}
              </a>
            )}
            {c.imageUrl && (
              <a
                href={c.imageUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-emerald-700 hover:underline"
              >
                {t("menuImage")}
              </a>
            )}
            {entry.last_seen_at && <span>{t("seen", { date: new Date(entry.last_seen_at).toLocaleDateString(locale) })}</span>}
            {expiresIn !== null && <span>{t("expires", { n: expiresIn })}</span>}
            {critical && (
              <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{t("checkCarefully")}</span>
            )}
            {conflicted && (
              <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700">{t("disagree")}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {offering?.amount && !(c.normalized as { currency?: string | null })?.currency ? (
            // A printed price without a printed currency: the owner's confirmation supplies it.
            <form action={confirmFactWithEditAction}>
              <input type="hidden" name="entryId" value={entry.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="name" value={offering.name ?? ""} />
              <input type="hidden" name="amount" value={offering.amount} />
              <Button type="submit" variant="secondary" className="px-2 py-1 text-xs text-emerald-700">
                {t("confirmAs", { amount: offering.amount, currency })}
              </Button>
            </form>
          ) : (
            <form action={approveBrainEntryAction}>
              <input type="hidden" name="entryId" value={entry.id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary" className="px-2 py-1 text-xs text-emerald-700">
                {conflicted ? t("useThis") : t("confirm")}
              </Button>
            </form>
          )}
          <form action={rejectBrainEntryAction}>
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <Button type="submit" variant="danger" className="px-2 py-1 text-xs">
              {t("reject")}
            </Button>
          </form>
        </div>
      </div>
      {editable && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-slate-600">{t("editConfirm")}</summary>
          <form action={confirmFactWithEditAction} className="mt-2 flex flex-wrap items-end gap-2">
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            {offering ? (
              <>
                <label className="flex flex-col gap-1 text-xs">
                  {t("name")}
                  <input
                    name="name"
                    defaultValue={offering.name ?? ""}
                    required
                    maxLength={160}
                    className="w-56 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  {t("price", { currency })}
                  <input
                    name="amount"
                    defaultValue={offering.amount ?? ""}
                    inputMode="decimal"
                    placeholder={t("leaveEmpty")}
                    className="w-36 rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                </label>
              </>
            ) : (
              <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs">
                {t("correctValue")}
                <textarea
                  name="value"
                  defaultValue={c.display}
                  required
                  maxLength={4000}
                  rows={2}
                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                  dir="auto"
                />
              </label>
            )}
            <Button type="submit" className="px-3 py-1.5 text-xs">
              {t("saveConfirm")}
            </Button>
          </form>
        </details>
      )}
      {alsoSeen.length > 0 && (
        <p className="mt-1.5 text-xs text-slate-500" dir="auto">
          {t("alsoFound", { list: alsoSeen.map((other) => `${sourceName(t, other.source_type)} (${contentOf(other).display})`).join(" · ") })}
        </p>
      )}
      {entry.entry_type === "hours" && (
        <p className="mt-1 text-xs text-slate-500">
          {t("hoursNote")}
        </p>
      )}
    </li>
  );
}
