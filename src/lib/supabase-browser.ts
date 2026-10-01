import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env.public";
import type { Database } from "@/types/database";

/**
 * The browser-side Supabase client (one per tab — `createBrowserClient` is a
 * singleton in the browser). It reads the signed-in session from the same
 * cookies the server uses, so every query and Realtime subscription runs as
 * the signed-in user under RLS — never with elevated keys.
 */
export function browserSupabase() {
  return createBrowserClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
