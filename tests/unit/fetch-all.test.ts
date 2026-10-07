import { describe, expect, it } from "vitest";

import { fetchAll, fetchByIds } from "@/server/supabase/fetch-all";

/** A table of `n` rows served the way the data API does: never more than `maxRows` per request. */
function api(n: number, maxRows: number) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i }));
  let requests = 0;
  const page = async (from: number, to: number) => {
    requests++;
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null };
  };
  return { page, requests: () => requests };
}

describe("reading every row", () => {
  it("returns all rows past the per-request cap", async () => {
    const t = api(2500, 1000);
    const rows = await fetchAll(t.page);
    expect(rows).toHaveLength(2500);
    expect(rows.at(-1)).toEqual({ id: 2499 });
    expect(t.requests()).toBe(4); // 1000 + 1000 + 500, then an empty page
  });

  it("stays complete when the server's cap is smaller than the page asked for", async () => {
    const rows = await fetchAll(api(2300, 300).page);
    expect(rows).toHaveLength(2300);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2300);
  });

  it("handles empty tables and stops on an error", async () => {
    expect(await fetchAll(api(0, 1000).page)).toEqual([]);
    let calls = 0;
    const failing = async () => (++calls === 1 ? { data: [{ id: 1 }], error: null } : { data: null, error: new Error("down") });
    expect(await fetchAll(failing)).toEqual([{ id: 1 }]);
  });

  it("reads a long list of ids in groups", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const groups: number[] = [];
    const rows = await fetchByIds(ids, async (group, from) => {
      if (from === 0) groups.push(group.length);
      return { data: from === 0 ? group.map((id) => ({ id })) : [], error: null };
    });
    expect(rows).toHaveLength(450);
    expect(groups).toEqual([100, 100, 100, 100, 50]);
  });
});
