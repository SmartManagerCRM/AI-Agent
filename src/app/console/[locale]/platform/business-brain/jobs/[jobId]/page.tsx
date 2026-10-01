import Link from "next/link";
import { notFound } from "next/navigation";

import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

const LEVEL_STYLE: Record<string, string> = {
  info: "bg-slate-300",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  error: "bg-red-500",
};

/** Super Admin: one Business Discovery job — counters, costs, AI calls and its step-by-step timeline. */
export default async function IngestionJobPage({ params }: { params: Promise<{ locale: string; jobId: string }> }) {
  const { locale, jobId } = await params;
  await requireSuperAdmin(locale);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) notFound();
  const supabase = await createUserClient();
  // Cost columns are hidden from signed-in users (column grants) — Super Admin checked above.
  const admin = serviceClient();

  const [{ data: job }, { data: events }, { data: calls }] = await Promise.all([
    admin.from("brain_ingestion_jobs").select("*").eq("id", jobId).maybeSingle(),
    supabase.from("brain_ingestion_events").select("id, at, step, level, message, data").eq("job_id", jobId).order("id"),
    admin
      .from("agent_interactions")
      .select("created_at, purpose, provider, model, input_tokens, output_tokens, estimated_cost_usd, latency_ms, success, error_message")
      .eq("ingestion_job_id", jobId)
      .order("created_at"),
  ]);
  if (!job) notFound();
  const { data: tenant } = await supabase.from("tenants").select("slug, business_name").eq("id", job.tenant_id).maybeSingle();

  const total = Number(job.google_cost_usd) + Number(job.ai_cost_usd);
  const warnings = Array.isArray(job.warnings) ? (job.warnings as string[]) : [];
  const errors = Array.isArray(job.errors) ? (job.errors as { step: string; message: string }[]) : [];
  const duration =
    job.started_at && job.completed_at ? Math.round((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000) : null;
  const input = (job.input ?? {}) as { mapsInput?: string | null; websiteUrl?: string | null };

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link href={`/${locale}/super-admin/business-brain`} prefetch={false} className="text-xs text-emerald-700 hover:underline">
          ← Business Brain
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          Analysis · {tenant?.business_name.en ?? tenant?.slug ?? "Business"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          <span className="capitalize">{job.status.replace(/_/g, " ")}</span> · {job.trigger} · started{" "}
          {new Date(job.created_at).toLocaleString(locale)}
          {duration !== null && ` · ${duration}s`}
          {job.status_reason && ` · ${job.status_reason}`}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Inputs: {input.mapsInput ? "Google Maps listing" : "no Maps listing"} · {input.websiteUrl ?? "no website given"}
          {job.detected_business_type && ` · detected type: ${job.detected_business_type}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ["Pages / documents", `${job.pages_processed} / ${job.documents_processed}`],
          ["Facts proposed", String(job.facts_proposed)],
          ["Conflicts", String(job.conflicts_detected)],
          ["Sources", String(job.sources_processed)],
          ["Google calls", `${job.google_calls} · $${Number(job.google_cost_usd).toFixed(4)}`],
          ["AI calls", `${job.ai_calls} · $${Number(job.ai_cost_usd).toFixed(4)}`],
          ["AI tokens", `${job.ai_input_tokens.toLocaleString()} / ${job.ai_output_tokens.toLocaleString()}`],
          ["Total / budget", `$${total.toFixed(4)} / $${Number(job.budget_usd).toFixed(2)}`],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="font-medium text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {(errors.length > 0 || warnings.length > 0) && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 text-sm">
          {errors.map((e, i) => (
            <p key={`e${i}`} className="text-red-700">
              {e.step}: {e.message}
            </p>
          ))}
          {warnings.map((w, i) => (
            <p key={`w${i}`} className="text-amber-800">
              {w}
            </p>
          ))}
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Timeline</h2>
        <ol className="flex flex-col gap-2 text-sm">
          {(events ?? []).map((e) => (
            <li key={e.id} className="flex gap-3">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${LEVEL_STYLE[e.level] ?? "bg-slate-300"}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-slate-800">{e.message}</p>
                <p className="text-xs text-slate-500">
                  {new Date(e.at).toLocaleTimeString(locale)} · {e.step.replace(/_/g, " ")}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">AI calls ({(calls ?? []).length})</h2>
        {(calls ?? []).length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 text-start font-medium">Purpose</th>
                  <th className="py-1.5 text-start font-medium">Model</th>
                  <th className="py-1.5 text-start font-medium">Tokens in/out</th>
                  <th className="py-1.5 text-start font-medium">Latency</th>
                  <th className="py-1.5 text-start font-medium">Cost</th>
                  <th className="py-1.5 text-start font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {(calls ?? []).map((c, i) => (
                  <tr key={i} className="border-b border-slate-100 last:border-0">
                    <td className="py-1.5 text-slate-900">{c.purpose}</td>
                    <td className="py-1.5 text-slate-600">{c.model}</td>
                    <td className="py-1.5 text-slate-600">
                      {c.input_tokens} / {c.output_tokens}
                    </td>
                    <td className="py-1.5 text-slate-600">{c.latency_ms ?? "—"} ms</td>
                    <td className="py-1.5 text-slate-600">${Number(c.estimated_cost_usd).toFixed(5)}</td>
                    <td className={`py-1.5 ${c.success ? "text-emerald-700" : "text-red-600"}`}>{c.success ? "ok" : (c.error_message ?? "failed")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No AI calls — this analysis was handled entirely by rules and structured data.</p>
        )}
      </section>
    </div>
  );
}
