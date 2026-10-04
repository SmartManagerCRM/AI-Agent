import "server-only";

import { RESERVED_SLUGS } from "@/lib/reserved-slugs";
import { slugify } from "@/lib/slugify";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/** A free slug for a new business, from its name (never a reserved path). */
export async function generateUniqueSlug(supabase: TypedSupabaseClient, businessName: string): Promise<string> {
  const base = slugify(businessName) || "business";
  let candidate = base;
  for (let attempt = 1; attempt <= 50; attempt++) {
    if (!RESERVED_SLUGS.has(candidate)) {
      const { data } = await supabase.from("tenants").select("id").eq("slug", candidate).maybeSingle();
      if (!data) return candidate;
    }
    const suffix = `-${attempt + 1}`;
    candidate = `${base.slice(0, 48 - suffix.length)}${suffix}`;
  }
  return `${base.slice(0, 40)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** `base` with a short random ending, still a valid slug (≤ 48 characters, ends in a letter or digit). */
export function slugVariant(base: string): string {
  const suffix = `-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).padStart(6, "0").slice(0, 6)}`;
  return `${base.slice(0, 48 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/**
 * Runs `create` with a free slug for `businessName`. The check above only sees
 * the businesses the signed-in user may read (RLS), so a name already used by
 * someone else's business can still collide; the database then refuses the
 * slug (unique violation, 23505) and it's retried with a random ending.
 */
export async function withFreeSlug<E extends { code?: string } | null>(
  supabase: TypedSupabaseClient,
  businessName: string,
  create: (slug: string) => PromiseLike<{ error: E }>,
): Promise<{ slug: string; error: E }> {
  const first = await generateUniqueSlug(supabase, businessName);
  let slug = first;
  let { error } = await create(slug);
  for (let attempt = 0; error?.code === "23505" && attempt < 3; attempt++) {
    slug = slugVariant(first);
    ({ error } = await create(slug));
  }
  return { slug, error };
}
