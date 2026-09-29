import Link from "next/link";

/** `?page=` → a 1-based page number; anything missing or invalid is page 1. */
export function parsePage(value: string | undefined): number {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * Server-side pagination footer. Renders nothing when every row fits on
 * one page, so a list that was never long enough to need it looks exactly
 * as it did before pagination existed. Preserves every other query param
 * (search, status tab, …) and only swaps `page`.
 */
export function Pagination({
  basePath,
  params,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  params: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  if (total <= pageSize && page === 1) return null;

  const href = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) if (value && key !== "page") search.set(key, value);
    if (target > 1) search.set("page", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };
  // From a page past the end (a stale link), "Previous" goes to the last real page.
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const previous = Math.min(page - 1, lastPage);
  const from = total === 0 ? 0 : Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  const linkClass =
    "rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50";

  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"
    >
      <span>
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(previous)} prefetch={false} className={linkClass}>
            Previous
          </Link>
        )}
        {page * pageSize < total && (
          <Link href={href(page + 1)} prefetch={false} className={linkClass}>
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}
