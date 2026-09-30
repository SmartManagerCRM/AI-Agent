import "server-only";

import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * Super Admin view of what Business Discovery costs — every number summed
 * from real rows: `brain_ingestion_jobs` (per-job Google/AI counters) and
 * `agent_interactions` rows of request type `brain_ingestion` (one per AI
 * call, with model, tokens and cost). Google costs are SmartManager's own
 * list-price *estimates* (see `PLACES_CONFIG`), not Google's invoice.
 */
export type IngestionEconomics = {
  since: string;
  jobs: number;
  byStatus: Record<string, number>;
  googleCalls: number;
  googleCostUsd: number;
  aiCalls: number;
  aiFailedCalls: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCostUsd: number;
  avgCostPerJobUsd: number;
  avgCostPerBusinessUsd: number;
  byModel: { model: string; provider: string; calls: number; failed: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number }[];
  byPurpose: { purpose: string; calls: number; costUsd: number }[];
  byTenant: { tenantId: string; slug: string; businessName: string; jobs: number; googleCostUsd: number; aiCostUsd: number; totalUsd: number; failedJobs: number }[];
  alerts: { jobId: string; slug: string; message: string; severity: "warning" | "critical" }[];
  recentJobs: {
    id: string;
    slug: string;
    businessName: string;
    status: string;
    createdAt: string;
    pages: number;
    facts: number;
    conflicts: number;
    googleCalls: number;
    aiCalls: number;
    totalUsd: number;
    budgetUsd: number;
  }[];
};

const DAY = 86_400_000;

export async function getIngestionEconomics(supabase: TypedSupabaseClient, days = 30): Promise<IngestionEconomics> {
  const since = new Date(Date.now() - days * DAY).toISOString();
  const [{ data: jobs }, { data: calls }, { data: tenants }] = await Promise.all([
    supabase
      .from("brain_ingestion_jobs")
      .select("id, tenant_id, status, created_at, pages_processed, facts_proposed, conflicts_detected, google_calls, google_cost_usd, ai_calls, ai_cost_usd, budget_usd")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(2000),
    supabase
      .from("agent_interactions")
      .select("tenant_id, provider, model, input_tokens, output_tokens, estimated_cost_usd, success, latency_ms, purpose")
      .eq("request_type", "brain_ingestion")
      .gte("created_at", since)
      .limit(20000),
    supabase.from("tenants").select("id, slug, business_name"),
  ]);

  const tenantById = new Map((tenants ?? []).map((t) => [t.id, t]));
  const nameOf = (id: string) => {
    const t = tenantById.get(id);
    return { slug: t?.slug ?? "—", businessName: t?.business_name.en ?? Object.values(t?.business_name ?? {})[0] ?? t?.slug ?? "—" };
  };

  const byStatus: Record<string, number> = {};
  const tenantAgg = new Map<string, { jobs: number; google: number; ai: number; failed: number }>();
  let googleCalls = 0;
  let googleCostUsd = 0;
  for (const j of jobs ?? []) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
    googleCalls += j.google_calls;
    googleCostUsd += Number(j.google_cost_usd);
    const agg = tenantAgg.get(j.tenant_id) ?? { jobs: 0, google: 0, ai: 0, failed: 0 };
    agg.jobs += 1;
    agg.google += Number(j.google_cost_usd);
    agg.ai += Number(j.ai_cost_usd);
    if (j.status === "failed") agg.failed += 1;
    tenantAgg.set(j.tenant_id, agg);
  }

  const modelAgg = new Map<string, IngestionEconomics["byModel"][number] & { latencySum: number }>();
  const purposeAgg = new Map<string, { calls: number; costUsd: number }>();
  let aiCalls = 0;
  let aiFailedCalls = 0;
  let aiInputTokens = 0;
  let aiOutputTokens = 0;
  let aiCostUsd = 0;
  for (const c of calls ?? []) {
    aiCalls += 1;
    if (!c.success) aiFailedCalls += 1;
    aiInputTokens += c.input_tokens ?? 0;
    aiOutputTokens += c.output_tokens ?? 0;
    aiCostUsd += Number(c.estimated_cost_usd ?? 0);
    const key = `${c.provider}/${c.model}`;
    const m = modelAgg.get(key) ?? { model: c.model ?? "—", provider: c.provider ?? "—", calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, avgLatencyMs: 0, latencySum: 0 };
    m.calls += 1;
    if (!c.success) m.failed += 1;
    m.inputTokens += c.input_tokens ?? 0;
    m.outputTokens += c.output_tokens ?? 0;
    m.costUsd += Number(c.estimated_cost_usd ?? 0);
    m.latencySum += c.latency_ms ?? 0;
    modelAgg.set(key, m);
    const purpose = (c.purpose ?? "other").split(":")[0] === "extract" ? (c.purpose ?? "extract") : (c.purpose ?? "other");
    const p = purposeAgg.get(purpose) ?? { calls: 0, costUsd: 0 };
    p.calls += 1;
    p.costUsd += Number(c.estimated_cost_usd ?? 0);
    purposeAgg.set(purpose, p);
  }

  const jobCount = (jobs ?? []).length;
  const totalUsd = googleCostUsd + aiCostUsd;
  const avgPerJob = jobCount > 0 ? totalUsd / jobCount : 0;

  const alerts: IngestionEconomics["alerts"] = [];
  for (const j of jobs ?? []) {
    const cost = Number(j.google_cost_usd) + Number(j.ai_cost_usd);
    const { slug } = nameOf(j.tenant_id);
    if (cost > Number(j.budget_usd) * 1.1) {
      alerts.push({ jobId: j.id, slug, severity: "critical", message: `Cost $${cost.toFixed(4)} exceeded its $${Number(j.budget_usd).toFixed(2)} budget.` });
    } else if (jobCount >= 5 && avgPerJob > 0 && cost > avgPerJob * 3) {
      alerts.push({ jobId: j.id, slug, severity: "warning", message: `Cost $${cost.toFixed(4)} is over 3× the average job ($${avgPerJob.toFixed(4)}).` });
    }
  }
  for (const [tenantId, agg] of tenantAgg) {
    const recent = (jobs ?? []).filter((j) => j.tenant_id === tenantId && Date.now() - new Date(j.created_at).getTime() < DAY).length;
    if (recent >= 6) alerts.push({ jobId: "", slug: nameOf(tenantId).slug, severity: "warning", message: `${recent} analyses in the last 24 hours.` });
    if (agg.jobs >= 3 && agg.failed / agg.jobs >= 0.5) {
      alerts.push({ jobId: "", slug: nameOf(tenantId).slug, severity: "warning", message: `${agg.failed} of ${agg.jobs} analyses failed.` });
    }
  }

  return {
    since,
    jobs: jobCount,
    byStatus,
    googleCalls,
    googleCostUsd,
    aiCalls,
    aiFailedCalls,
    aiInputTokens,
    aiOutputTokens,
    aiCostUsd,
    avgCostPerJobUsd: avgPerJob,
    avgCostPerBusinessUsd: tenantAgg.size > 0 ? totalUsd / tenantAgg.size : 0,
    byModel: [...modelAgg.values()]
      .map(({ latencySum, ...m }) => ({ ...m, avgLatencyMs: m.calls > 0 ? Math.round(latencySum / m.calls) : 0 }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byPurpose: [...purposeAgg.entries()].map(([purpose, v]) => ({ purpose, ...v })).sort((a, b) => b.costUsd - a.costUsd),
    byTenant: [...tenantAgg.entries()]
      .map(([tenantId, a]) => ({ tenantId, ...nameOf(tenantId), jobs: a.jobs, googleCostUsd: a.google, aiCostUsd: a.ai, totalUsd: a.google + a.ai, failedJobs: a.failed }))
      .sort((a, b) => b.totalUsd - a.totalUsd),
    alerts: alerts.slice(0, 20),
    recentJobs: (jobs ?? []).slice(0, 25).map((j) => ({
      id: j.id,
      ...nameOf(j.tenant_id),
      status: j.status,
      createdAt: j.created_at,
      pages: j.pages_processed,
      facts: j.facts_proposed,
      conflicts: j.conflicts_detected,
      googleCalls: j.google_calls,
      aiCalls: j.ai_calls,
      totalUsd: Number(j.google_cost_usd) + Number(j.ai_cost_usd),
      budgetUsd: Number(j.budget_usd),
    })),
  };
}
