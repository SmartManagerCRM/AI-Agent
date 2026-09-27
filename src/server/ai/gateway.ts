import "server-only";

import { buildBrainSnapshot } from "./deterministic/snapshot";
import { matchDeterministic } from "./deterministic/match";
import { calculateCostUsd } from "./pricing";
import { fallbackChain, loadModelConfigs, type ModelKind } from "./router";
import type { TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * The Agent Gateway (spec §7): "Can deterministic logic handle it? YES →
 * business logic. NO → AI model." Every call — deterministic or AI — is
 * recorded through `record_agent_interaction`, which is what makes "% of
 * interactions handled without AI" (spec §69) a real, queryable number
 * (`agent_interaction_stats`) instead of an aspiration.
 */
export type GatewayInput = {
  tenant: { id: string; currency: string; slug: string };
  locale: string;
  requestType: string;
  message: string;
  kind?: ModelKind;
};

export type GatewayResult =
  | { handledBy: "deterministic"; reply: string; rule: string }
  | {
      handledBy: "ai";
      reply: string;
      provider: string;
      model: string;
      costUsd: number;
      fallbackUsed: boolean;
    }
  | { handledBy: "ai"; reply: string; error: string };

export async function runAgentGateway(supabase: TypedSupabaseClient, input: GatewayInput): Promise<GatewayResult> {
  const snapshot = await buildBrainSnapshot(supabase, input.tenant, input.locale);
  const deterministic = matchDeterministic(input.message, snapshot);

  if (deterministic) {
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: deterministic.rule,
    });
    return { handledBy: "deterministic", reply: deterministic.reply, rule: deterministic.rule };
  }

  return runAiFallback(supabase, input, snapshot.assistantName, snapshot.greeting);
}

async function runAiFallback(
  supabase: TypedSupabaseClient,
  input: GatewayInput,
  assistantName: string | null,
  greeting: string | null,
): Promise<GatewayResult> {
  const kind = input.kind ?? "fast";
  const rows = await loadModelConfigs(supabase);
  const chain = fallbackChain(rows, kind);

  if (chain.length === 0) {
    const reply = greeting || "I'm sorry, I can't help with that right now — please contact the business directly.";
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "ai",
      success: false,
      errorMessage: "NOT_CONFIGURED: no AI provider is configured.",
    });
    return { handledBy: "ai", reply, error: "NOT_CONFIGURED: no AI provider is configured." };
  }

  const system = [
    `You are ${assistantName || "a helpful assistant"} for this business.`,
    "Answer only from information you are given in this conversation.",
    "If you do not know something, say so honestly rather than guessing — never invent prices, availability, or policies.",
    "Keep replies short and conversational.",
  ].join(" ");

  let lastError = "";
  for (let i = 0; i < chain.length; i++) {
    const { row, provider } = chain[i];
    const startedAt = Date.now();
    const result = await provider.chat({
      model: row.model,
      system,
      messages: [{ role: "user", content: [{ type: "text", text: input.message }] }],
      maxTokens: 512,
    });
    const latencyMs = Date.now() - startedAt;

    if (result.ok) {
      const text = result.value.content.find((b) => b.type === "text")?.text ?? "";
      const costUsd = calculateCostUsd(
        { inputPricePerMillionUsd: row.input_price_per_million_usd, outputPricePerMillionUsd: row.output_price_per_million_usd },
        result.value.usage.inputTokens,
        result.value.usage.outputTokens,
      );
      await recordInteraction(supabase, {
        tenantId: input.tenant.id,
        requestType: input.requestType,
        handledBy: "ai",
        provider: row.provider,
        model: row.model,
        inputTokens: result.value.usage.inputTokens,
        outputTokens: result.value.usage.outputTokens,
        costUsd,
        latencyMs,
        success: true,
        fallbackUsed: i > 0,
      });
      return { handledBy: "ai", reply: text, provider: row.provider, model: row.model, costUsd, fallbackUsed: i > 0 };
    }

    lastError = result.error;
  }

  await recordInteraction(supabase, {
    tenantId: input.tenant.id,
    requestType: input.requestType,
    handledBy: "ai",
    success: false,
    fallbackUsed: chain.length > 1,
    errorMessage: lastError,
  });
  return {
    handledBy: "ai",
    reply: "I'm having trouble reaching my AI assistant right now — please try again shortly.",
    error: lastError,
  };
}

async function recordInteraction(
  supabase: TypedSupabaseClient,
  params: {
    tenantId: string;
    requestType: string;
    handledBy: "deterministic" | "ai";
    deterministicRule?: string;
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
    latencyMs?: number;
    success?: boolean;
    fallbackUsed?: boolean;
    errorMessage?: string;
  },
): Promise<void> {
  await supabase.rpc("record_agent_interaction", {
    p_tenant_id: params.tenantId,
    p_request_type: params.requestType,
    p_handled_by: params.handledBy,
    p_deterministic_rule: params.deterministicRule ?? null,
    p_provider: params.provider ?? null,
    p_model: params.model ?? null,
    p_input_tokens: params.inputTokens ?? 0,
    p_output_tokens: params.outputTokens ?? 0,
    p_estimated_cost_usd: params.costUsd ?? 0,
    p_latency_ms: params.latencyMs ?? null,
    p_success: params.success ?? true,
    p_fallback_used: params.fallbackUsed ?? false,
    p_error_message: params.errorMessage ?? null,
  });
}
