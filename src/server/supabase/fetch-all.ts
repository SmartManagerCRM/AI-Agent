/**
 * Every row a query matches, however many there are.
 *
 * The data API answers one request with a bounded number of rows (Supabase's
 * "Max rows", 1000 by default) and silently drops the rest — so a business
 * with more than that many products, members or orders would quietly lose
 * some from any screen that reads "all" of them in one request. This reads
 * page after page until a page comes back empty, so it stays complete
 * whatever that setting is. `page` must build the same query each time with
 * a stable order (end with `.order("id")`) and apply the given range.
 */
export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (;;) {
    const { data, error } = await page(rows.length, rows.length + pageSize - 1);
    if (error || !data || data.length === 0) return rows;
    rows.push(...data);
  }
}

/** The same, shaped like a single query's result (`{ data }`) — a drop-in inside `Promise.all`. */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ data: T[] }> {
  return { data: await fetchAll(page) };
}

/**
 * Every row for a list of ids, however long the list: asked in groups (a
 * long `in (…)` list would not fit in one request), each group read in full.
 */
export async function fetchByIds<T>(
  ids: readonly string[],
  page: (ids: string[], from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  groupSize = 100,
): Promise<T[]> {
  const unique = [...new Set(ids)];
  const rows: T[] = [];
  for (let i = 0; i < unique.length; i += groupSize) {
    const group = unique.slice(i, i + groupSize);
    rows.push(...(await fetchAll((from, to) => page(group, from, to))));
  }
  return rows;
}
