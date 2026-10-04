import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { slugVariant, withFreeSlug } from "@/server/business/slug";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

const SLUG_FORMAT = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/; // tenants_slug_format

/** A client whose `tenants` lookups see nothing (as RLS hides other owners' businesses). */
const blindClient = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }),
} as unknown as TypedSupabaseClient;

describe("business slugs", () => {
  it("a variant keeps the slug format and length", () => {
    for (const base of ["cafe-roma", "a", "x".repeat(48), `${"y".repeat(41)}-z`]) {
      const v = slugVariant(base);
      expect(v).toMatch(SLUG_FORMAT);
      expect(v.length).toBeLessThanOrEqual(48);
      expect(v).not.toBe(base);
    }
  });

  it("retries with a new slug when the database says it is taken", async () => {
    const tried: string[] = [];
    const { slug, error } = await withFreeSlug(blindClient, "Cafe Roma", async (s) => {
      tried.push(s);
      return { error: tried.length === 1 ? { code: "23505" } : null };
    });
    expect(error).toBeNull();
    expect(tried[0]).toBe("cafe-roma");
    expect(slug).toBe(tried[1]);
    expect(slug).toMatch(/^cafe-roma-[a-z0-9]{6}$/);
  });

  it("does not retry other errors", async () => {
    let calls = 0;
    const { error } = await withFreeSlug(blindClient, "Cafe Roma", async () => {
      calls++;
      return { error: { code: "22023" } };
    });
    expect(calls).toBe(1);
    expect(error?.code).toBe("22023");
  });
});
