import "server-only";

import { after } from "next/server";

import { runIngestionJob, STALE_JOB_MINUTES, type IngestionInput } from "./pipeline";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";
import type { IngestionJobStatus, Json } from "@/types/database";

/** Abuse/cost guard: analyses a business may start per rolling 24 hours. */
export const MAX_JOBS_PER_DAY = 10;

export type StartResult = { ok: true; jobId: string } | { ok: false; error: string; jobId?: string };

/**
 * Creates an ingestion job and runs it in the background after the
 * response is sent (`after()`), with the caller's own RLS-scoped client —
 * no queue, worker or extra infrastructure. One active job per business.
 */
export async function startDiscoveryJob(
  supabase: TypedSupabaseClient,
  params: { tenantId: string; userId: string; input: IngestionInput; trigger: "onboarding" | "manual" | "refresh" },
): Promise<StartResult> {
  const staleBefore = new Date(Date.now() - STALE_JOB_MINUTES * 60_000).toISOString();
  const active: IngestionJobStatus[] = ["created", "discovering", "fetching", "extracting", "ai_processing", "normalizing", "validating", "conflict_check"];

  // A job whose server went away mid-run (deploy/restart) is closed, not left "running" forever.
  await supabase
    .from("brain_ingestion_jobs")
    .update({ status: "failed", status_reason: "Interrupted — the server restarted during the analysis.", completed_at: new Date().toISOString() })
    .eq("tenant_id", params.tenantId)
    .in("status", active)
    .lt("updated_at", staleBefore);

  const { data: running } = await supabase
    .from("brain_ingestion_jobs")
    .select("id")
    .eq("tenant_id", params.tenantId)
    .in("status", active)
    .limit(1)
    .maybeSingle();
  if (running) return { ok: false, error: "An analysis is already running.", jobId: running.id };

  const { count } = await supabase
    .from("brain_ingestion_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.tenantId)
    .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
  if ((count ?? 0) >= MAX_JOBS_PER_DAY) return { ok: false, error: "Daily analysis limit reached — try again tomorrow." };

  const { data: job, error } = await supabase
    .from("brain_ingestion_jobs")
    .insert({
      tenant_id: params.tenantId,
      trigger: params.trigger,
      input: params.input as unknown as Json,
      status: "created",
      created_by: params.userId,
    })
    .select("id")
    .single();
  if (error || !job) return { ok: false, error: "Could not start the analysis." };

  // The service role reads only what signed-in users can't (budget, model prices); every write stays the owner's.
  after(() => runIngestionJob(supabase, job.id, { privileged: serviceClient() }));
  return { ok: true, jobId: job.id };
}
