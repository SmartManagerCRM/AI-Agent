import "server-only";

import { isContentLang } from "./types";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Which of these rows show a text in `lang` that was filled in automatically
 * (and not changed by anyone since) — the console marks them so the owner can
 * check and correct them. Read with the member's own (RLS-scoped) client.
 */
export async function autoTranslated(
  supabase: TypedSupabaseClient,
  table: string,
  field: string,
  lang: string,
  rows: { key: string; value: string | undefined }[],
): Promise<Set<string>> {
  const keys = rows.filter((r) => r.value).map((r) => r.key);
  if (keys.length === 0 || !isContentLang(lang)) return new Set();
  const { data } = await supabase
    .from("content_translations")
    .select("row_key, value")
    .eq("table_name", table)
    .eq("field", field)
    .eq("lang", lang)
    .in("row_key", keys);
  const auto = new Map((data ?? []).map((m) => [m.row_key, m.value]));
  return new Set(rows.filter((r) => r.value && auto.get(r.key)?.trim() === r.value.trim()).map((r) => r.key));
}
