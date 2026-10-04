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
