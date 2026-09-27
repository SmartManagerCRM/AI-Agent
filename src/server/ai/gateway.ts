import "server-only";

import { isEntitled } from "@/server/billing/entitlement";
import { buildBrainSnapshot } from "./deterministic/snapshot";
import { matchDeterministic } from "./deterministic/match";
import { calculateCostUsd } from "./pricing";
import { fallbackChain, loadModelConfigs, type ModelKind } from "./router";
import { buildSystemPrompt } from "./system-prompt";
import { AGENT_TOOLS } from "./tools/registry";
import { executeTool, type ToolContext } from "./tools/handlers";
import type { AITurnMessage, ContentBlock } from "./provider";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

/**
 * The Agent Gateway (spec §7): "Can deterministic logic handle it? YES →
 * business logic. NO → AI model." Every call — deterministic or AI — is
 * recorded through `record_agent_interaction`, which is what makes "% of
 * interactions handled without AI" (spec §69) a real, queryable number
 * (`agent_interaction_stats`) instead of an aspiration.
 *
 * This module knows nothing about the `conversations` table — the caller
 * loads whatever history it wants remembered and passes it in as `history`.
 * Tool execution (Phase 5's cart/order tools, spec §13) is **only enabled
 * when `conversationId` is supplied** — the console's Agent preview
 * (spec §73's "clearly marked test environment... do not accidentally
 * create real orders") deliberately omits it, so a staff test message
 * still gets a text-only reply and can never write a real cart or order.
 */
const MAX_AGENT_STEPS = 8;

export type GatewayInput = {
  tenant: { id: string; currency: string; slug: string };
  locale: string;
  requestType: string;
  message: string;
  /** Prior turns, oldest first — omit for a stateless single-turn call. */
  history?: AITurnMessage[];
  /** Enables tool execution (cart/orders) scoped to this conversation. Omit for a tool-free preview reply. */
  conversationId?: string;
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
  // Entitlement (spec §98 Phase 7) is checked here — the one place every
  // caller (the External Agent, the console's Agent preview) funnels
  // through — via a service-role read regardless of which client `supabase`
  // is, so a caller's own RLS scope (e.g. a staff member without
  // `billing.read`) can never accidentally make a perfectly entitled
  // tenant look unentitled. A lapsed trial/subscription is a zero-cost,
  // deterministic outcome, not a reason to ever reach the AI provider.
  const { data: subscriptionRow } = await serviceClient()
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("tenant_id", input.tenant.id)
    .maybeSingle();
  if (
    !isEntitled(
      subscriptionRow
        ? { status: subscriptionRow.status, trialEndsAt: subscriptionRow.trial_ends_at, currentPeriodEnd: subscriptionRow.current_period_end }
        : null,
    )
  ) {
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: "trial_expired",
    });
    return {
      handledBy: "deterministic",
      reply: "This business's subscription isn't active right now — please check back later.",
      rule: "trial_expired",
    };
  }

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

  const kind = input.kind ?? "fast";
  const rows = await loadModelConfigs(supabase);
  const chain = fallbackChain(rows, kind);

  if (chain.length === 0) {
    const reply =
      snapshot.greeting || "I'm sorry, I can't help with that right now — please contact the business directly.";
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "ai",
      success: false,
      errorMessage: "NOT_CONFIGURED: no AI provider is configured.",
    });
    return { handledBy: "ai", reply, error: "NOT_CONFIGURED: no AI provider is configured." };
  }

  let toolContext: ToolContext | null = null;
  if (input.conversationId) {
    const { data: settings } = await supabase.from("tenant_settings").select("checkout").eq("tenant_id", input.tenant.id).maybeSingle();
    toolContext = {
      supabase,
      tenantId: input.tenant.id,
      conversationId: input.conversationId,
      locale: input.locale,
      currency: input.tenant.currency,
      currencyExponent: snapshot.currencyExponent,
      checkout: settings?.checkout ?? {
        ordering_enabled: false,
        fulfillment_types: ["pickup"],
        delivery_fee_minor: 0,
        minimum_order_minor: 0,
      },
    };
  }

  const system = buildSystemPrompt(snapshot);
  const messages: AITurnMessage[] = [
    ...(input.history ?? []),
    { role: "user", content: [{ type: "text", text: input.message }] },
  ];
  const tools = toolContext ? AGENT_TOOLS : undefined;

  let lastError = "";
  for (let i = 0; i < chain.length; i++) {
    const { row, provider } = chain[i];
    const startedAt = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = "";
    let stepError: string | null = null;

    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      const result = await provider.chat({ model: row.model, system, messages, tools, maxTokens: 512 });
      if (!result.ok) {
        stepError = result.error;
        break;
      }
      totalInputTokens += result.value.usage.inputTokens;
      totalOutputTokens += result.value.usage.outputTokens;

      const textBlock = result.value.content.find((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text");
      if (textBlock?.text) finalText = textBlock.text;

      const toolUseBlocks = result.value.content.filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use");
      if (result.value.stopReason !== "tool_use" || toolUseBlocks.length === 0 || !toolContext) {
        break;
      }

      messages.push({ role: "assistant", content: result.value.content });
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        const toolResult = await executeTool(toolUse.name, toolUse.input, toolContext);
        toolResults.push({ type: "tool_result", toolUseId: toolUse.id, content: toolResult.content, isError: toolResult.isError });
      }
      messages.push({ role: "user", content: toolResults });
    }

    const latencyMs = Date.now() - startedAt;

    if (!stepError) {
      const costUsd = calculateCostUsd(
        { inputPricePerMillionUsd: row.input_price_per_million_usd, outputPricePerMillionUsd: row.output_price_per_million_usd },
        totalInputTokens,
        totalOutputTokens,
      );
      await recordInteraction(supabase, {
        tenantId: input.tenant.id,
        requestType: input.requestType,
        handledBy: "ai",
        provider: row.provider,
        model: row.model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd,
        latencyMs,
        success: true,
        fallbackUsed: i > 0,
      });
      return {
        handledBy: "ai",
        reply: finalText || "Sorry, I didn't catch that — could you rephrase?",
        provider: row.provider,
        model: row.model,
        costUsd,
        fallbackUsed: i > 0,
      };
    }

    lastError = stepError;
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
