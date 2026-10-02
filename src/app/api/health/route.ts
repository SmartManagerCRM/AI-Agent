import { NextResponse } from "next/server";

import { anonymousClient } from "@/server/supabase/clients";

/**
 * Presence only, never values — safe to log and safe to return publicly.
 * The one thing this catches that `serverEnv()`/`publicEnv` parsing can't:
 * a var that's present but empty, which some hosting panels do when a field
 * is left blank rather than omitted.
 */
function envPresence() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
    SUPABASE_SECRET_KEY: Boolean(process.env.SUPABASE_SECRET_KEY),
    PLATFORM_ROOT_DOMAIN: Boolean(process.env.PLATFORM_ROOT_DOMAIN),
    CONSOLE_URL: Boolean(process.env.CONSOLE_URL),
    AGENT_SUBDOMAIN: Boolean(process.env.AGENT_SUBDOMAIN),
    ELEVENLABS_API_KEY: Boolean(process.env.ELEVENLABS_API_KEY),
  };
}

export async function GET() {
  const presence = envPresence();
  const supabaseConfigured = presence.NEXT_PUBLIC_SUPABASE_URL && presence.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  console.log("[health] env presence", presence);

  let database = false;
  try {
    const supabase = anonymousClient();
    const { error } = await supabase.from("business_types").select("key").limit(1);
    database = !error;
    if (error) console.error("[health] database check failed:", error.message);
  } catch (err) {
    console.error("[health] Supabase client threw:", err instanceof Error ? err.message : err);
  }

  const status = supabaseConfigured && database ? "ok" : "error";
  return NextResponse.json(
    { status, environment: process.env.NODE_ENV ?? "unknown", supabaseConfigured, database },
    { status: status === "ok" ? 200 : 503 },
  );
}
