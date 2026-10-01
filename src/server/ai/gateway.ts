import "server-only";

import { isEntitled } from "@/server/billing/entitlement";
import { getOrCreateCart, viewCart, type CartView } from "@/server/commerce/cart";
import { estimateCallCostUsd } from "@/server/billing/usage";
import { getCostGuardStatus } from "./cost-guard";
import { relevantProducts } from "./deterministic/catalog";
import { buildBrainSnapshot } from "./deterministic/snapshot";
import { agentLog, errorCategory } from "./diagnostics";
import { matchDeterministic } from "./deterministic/match";
import { geminiMaxOutputTokens } from "./gemini";
import { calculateCostUsd } from "./pricing";
import { fallbackChain, loadModelConfigs, type ModelKind } from "./router";
import { buildSystemPrompt } from "./system-prompt";
import { AGENT_TOOLS } from "./tools/registry";
import { executeTool, type ToolContext } from "./tools/handlers";
import { checkAiUsage, reserveAiCall, settleAiCall, type UsageLimit } from "./usage-guard";
import type { AITurnMessage, ContentBlock } from "./provider";
import { serviceClient, type TypedSupabaseClient } from "@/server/supabase/clients";

/** Tool names whose execution can change what `view_cart` would now show — spec §32 "AI + UI hybrid responses". */
const CART_MUTATING_TOOLS = new Set([
  "add_to_cart",
  "update_cart_item",
  "remove_from_cart",
  "clear_cart",
  "set_fulfillment",
  "set_payment_method",
  "apply_coupon",
]);

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
const MAX_OUTPUT_TOKENS = 512;

/**
 * What a customer sees when the subscriber's AI is limited (conversation
 * limit after its grace period, or the AI cost cap): never plans, limits or
 * costs — they can still browse, order and check out deterministically.
 * The console preview is the subscriber themself, so it gets the plan wording.
 */
const AI_LIMITED_CUSTOMER_REPLY: Record<string, { withProducts: string; plain: string }> = {
  en: {
    withProducts: "I can't give you a personal answer right now, but here's what we have that matches:",
    plain: "I can't answer that one right now. You can still browse the menu, order and check out here.",
  },
  ar: {
    withProducts: "لا يمكنني تقديم إجابة مخصصة الآن، لكن هذا ما لدينا ويطابق طلبك:",
    plain: "لا يمكنني الإجابة على ذلك الآن. لا يزال بإمكانك تصفح القائمة والطلب وإتمام الدفع هنا.",
  },
  fr: {
    withProducts: "Je ne peux pas vous donner une réponse personnalisée pour le moment, mais voici ce qui correspond :",
    plain:
      "Je ne peux pas répondre à cela pour le moment. Vous pouvez toujours parcourir le menu, commander et payer ici.",
  },
};
const AI_LIMITED_PREVIEW_REPLY =
  "AI service is temporarily limited for this billing period. Upgrade your plan or wait until your next billing period.";

export type GatewayInput = {
  tenant: { id: string; currency: string; slug: string };
  locale: string;
  requestType: string;
  message: string;
  /** Prior turns, oldest first — omit for a stateless single-turn call. */
  history?: AITurnMessage[];
  /** Enables tool execution (cart/orders) scoped to this conversation. Omit for a tool-free preview reply. */
  conversationId?: string;
  /** The real, already-validated `branch_tables` row this conversation started from (a dine-in QR link) — never a raw id, always re-validated by the caller against `branch_tables` first (spec §25/§39). Omit outside dine-in mode. */
  activeTable?: { id: string; branchId: string; label: string } | null;
  kind?: ModelKind;
};

export type GatewayResult =
  | { handledBy: "deterministic"; reply: string; rule: string; productIds?: string[] }
  | {
      handledBy: "ai";
      reply: string;
      provider: string;
      model: string;
      costUsd: number;
      fallbackUsed: boolean;
      /** Set only when a cart-mutating tool actually ran this turn (spec §32) — never a stale or guessed cart. */
      cart?: CartView | null;
    }
  | { handledBy: "ai"; reply: string; error: string; productIds?: string[] };

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
    .select("status, trial_ends_at, current_period_end, trial_limit_reached_at")
    .eq("tenant_id", input.tenant.id)
    .maybeSingle();
  const notEntitled = async (rule: string): Promise<GatewayResult> => {
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: rule,
    });
    return {
      handledBy: "deterministic",
      reply: "This business's subscription isn't active right now — please check back later.",
      rule,
    };
  };
  if (
    !isEntitled(
      subscriptionRow
        ? {
            status: subscriptionRow.status,
            trialEndsAt: subscriptionRow.trial_ends_at,
            currentPeriodEnd: subscriptionRow.current_period_end,
            trialLimitReachedAt: subscriptionRow.trial_limit_reached_at,
          }
        : null,
    )
  ) {
    return notEntitled(subscriptionRow?.trial_limit_reached_at ? "trial_limit_reached" : "trial_expired");
  }
  // A trial also ends once its conversations or AI allowance run out — checked
  // (and recorded) on every trial message, so the conversation that goes over
  // the limit is the first one refused, exactly like the end date.
  const trialUsage = subscriptionRow?.status === "trialing" ? await checkAiUsage(input.tenant.id) : null;
  if (trialUsage?.trialEnded) return notEntitled("trial_limit_reached");

  const snapshot = await buildBrainSnapshot(supabase, input.tenant, input.locale, input.conversationId);
  const log = { business_slug: input.tenant.slug, tenant_id: input.tenant.id, request_type: input.requestType };
  agentLog("context", {
    ...log,
    approved_product_count: snapshot.catalog?.products.length ?? 0,
    approved_category_count: snapshot.catalog?.categories.length ?? 0,
    knowledge_context_count: snapshot.knowledgeCount ?? 0,
  });
  // Newest first, for follow-ups like "how much is it?".
  const recent = (input.history ?? [])
    .slice(-6)
    .reverse()
    .flatMap((m) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])));
  const deterministic = matchDeterministic(input.message, snapshot, { recent });

  if (deterministic) {
    agentLog("intent", { ...log, intent: deterministic.rule, handled_by: "deterministic", tool_result_count: deterministic.resultCount ?? null });
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: deterministic.rule,
    });
    return { handledBy: "deterministic", reply: deterministic.reply, rule: deterministic.rule, productIds: deterministic.productIds };
  }
  agentLog("intent", { ...log, intent: "ai", handled_by: "ai" });

  // AI Cost Guard (spec §98): a real, operator-set monthly budget, never a
  // fabricated one — checked only here, after a free deterministic reply
  // has already been ruled out, so a business over budget still gets its
  // deterministic FAQ answers; only the paid AI fallback is what's gated.
  const guard = await getCostGuardStatus(input.tenant.id);
  if (guard.exceeded) {
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: "cost_guard_exceeded",
    });
    return {
      handledBy: "deterministic",
      reply: snapshot.greeting || "I'm sorry, I can't help with that right now — please contact the business directly.",
      rule: "cost_guard_exceeded",
    };
  }

  // Only the products this message is about reach the model — never the whole catalog.
  const relevant = snapshot.catalog ? relevantProducts(input.message, snapshot.catalog) : [];

  // Usage limits (AIUsageGuard): on paid plans the conversation limit after
  // its grace period and the hard AI cost cap; on trials the AI allowance.
  // Deterministic replies above never reach this point, so browsing, cart,
  // checkout and orders keep working.
  const usage = trialUsage ?? (await checkAiUsage(input.tenant.id));
  const limitedResult = async (limit: UsageLimit): Promise<GatewayResult> => {
    agentLog("usage_limited", { ...log, limit });
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: limit === "conversation_limit" ? "usage_conversation_limit" : "usage_ai_cost_limit",
    });
    const copy = AI_LIMITED_CUSTOMER_REPLY[input.locale] ?? AI_LIMITED_CUSTOMER_REPLY.en;
    if (input.requestType === "console_preview") {
      return { handledBy: "deterministic", reply: AI_LIMITED_PREVIEW_REPLY, rule: `usage_${limit}` };
    }
    if (relevant.length > 0) {
      return {
        handledBy: "deterministic",
        reply: copy.withProducts,
        rule: `usage_${limit}`,
        productIds: relevant.slice(0, 8).map((p) => p.id),
      };
    }
    return { handledBy: "deterministic", reply: copy.plain, rule: `usage_${limit}` };
  };
  if (usage.blocked) return limitedResult(usage.blocked);

  const kind = input.kind ?? "fast";
  // Model prices are hidden from signed-in users (column grants); the console preview runs as one.
  const rows = await loadModelConfigs(serviceClient());
  const chain = fallbackChain(rows, kind);

  if (chain.length === 0) {
    const reply =
      snapshot.greeting || "I'm sorry, I can't help with that right now — please contact the business directly.";
    agentLog("ai_unavailable", { ...log, error_code: "NOT_CONFIGURED" });
    // The ledger requires a provider on "ai" rows; with none configured this is recorded as a deterministic refusal.
    await recordInteraction(supabase, {
      tenantId: input.tenant.id,
      requestType: input.requestType,
      handledBy: "deterministic",
      deterministicRule: "ai_not_configured",
    });
    if (relevant.length > 0) {
      return {
        handledBy: "ai",
        reply: "I can't give you a personal recommendation right now, but here's what we have that matches:",
        error: "NOT_CONFIGURED: no AI provider is configured.",
        productIds: relevant.slice(0, 8).map((p) => p.id),
      };
    }
    return { handledBy: "ai", reply, error: "NOT_CONFIGURED: no AI provider is configured." };
  }

  let toolContext: ToolContext | null = null;
  if (input.conversationId) {
    const [{ data: settings }, { data: paymentConfig }] = await Promise.all([
      supabase.from("tenant_settings").select("checkout").eq("tenant_id", input.tenant.id).maybeSingle(),
      supabase.from("tenant_payment_config").select("enabled_methods").eq("tenant_id", input.tenant.id).maybeSingle(),
    ]);
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
      paymentMethods: paymentConfig?.enabled_methods ?? [],
      activeTable: input.activeTable ?? null,
    };
  }

  const system = buildSystemPrompt(snapshot, { relevantProducts: relevant });
  const messages: AITurnMessage[] = [
    ...(input.history ?? []),
    { role: "user", content: [{ type: "text", text: input.message }] },
  ];
  const tools = toolContext ? AGENT_TOOLS : undefined;

  let lastError = "";
  let lastModel: { provider: string; model: string } | null = null;
  let cartMutated = false;
  let limitedBy: UsageLimit | null = null;
  for (let i = 0; i < chain.length && !limitedBy; i++) {
    const { row, provider } = chain[i];
    const startedAt = Date.now();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = "";
    let stepError: string | null = null;

    const pricing = {
      inputPricePerMillionUsd: row.input_price_per_million_usd,
      outputPricePerMillionUsd: row.output_price_per_million_usd,
    };
    for (let step = 0; step < MAX_AGENT_STEPS; step++) {
      // Every model call reserves its worst-case cost first (paid plans; a no-op for trials).
      let reservationId: string | null = null;
      if (usage.governed) {
        const maxOutput =
          row.provider === "gemini" ? geminiMaxOutputTokens(row.model, MAX_OUTPUT_TOKENS) : MAX_OUTPUT_TOKENS;
        const promptChars =
          system.length + JSON.stringify(messages).length + (tools ? JSON.stringify(tools).length : 0);
        const reservation = await reserveAiCall(input.tenant.id, estimateCallCostUsd(pricing, promptChars, maxOutput));
        if (!reservation.allowed) {
          limitedBy = reservation.reason;
          break;
        }
        reservationId = reservation.reservationId;
      }
      const result = await provider.chat({ model: row.model, system, messages, tools, maxTokens: MAX_OUTPUT_TOKENS });
      if (reservationId) {
        const actual = result.ok
          ? calculateCostUsd(pricing, result.value.usage.inputTokens, result.value.usage.outputTokens)
          : 0;
        await settleAiCall(input.tenant.id, reservationId, actual);
      }
      if (!result.ok) {
        stepError = result.error;
        break;
      }
      totalInputTokens += result.value.usage.inputTokens;
      totalOutputTokens += result.value.usage.outputTokens;

      const textBlock = result.value.content.find(
        (b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text",
      );
      if (textBlock?.text) finalText = textBlock.text;

      const toolUseBlocks = result.value.content.filter(
        (b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use",
      );
      if (result.value.stopReason !== "tool_use" || toolUseBlocks.length === 0 || !toolContext) {
        break;
      }

      messages.push({ role: "assistant", content: result.value.content });
      const toolResults: ContentBlock[] = [];
      for (const toolUse of toolUseBlocks) {
        if (CART_MUTATING_TOOLS.has(toolUse.name)) cartMutated = true;
        const toolResult = await executeTool(toolUse.name, toolUse.input, toolContext);
        agentLog("tool", { ...log, tool_called: toolUse.name, tool_error: Boolean(toolResult.isError), tool_result_count: toolResult.resultCount ?? null });
        toolResults.push({
          type: "tool_result",
          toolUseId: toolUse.id,
          content: toolResult.content,
          isError: toolResult.isError,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // Limit reached before this provider made any call: nothing was spent — a limited reply, not a failure.
    if (limitedBy && totalInputTokens === 0 && totalOutputTokens === 0) break;

    const latencyMs = Date.now() - startedAt;
    agentLog("ai_call", {
      ...log,
      provider: row.provider,
      model: row.model,
      duration_ms: latencyMs,
      ok: !stepError,
      error_code: stepError ? errorCategory(stepError) : null,
    });

    if (!stepError) {
      const costUsd = calculateCostUsd(pricing, totalInputTokens, totalOutputTokens);
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
      let cart: CartView | null = null;
      if (cartMutated && toolContext) {
        const cartRow = await getOrCreateCart(supabase, input.tenant.id, toolContext.conversationId);
        cart = await viewCart(supabase, input.tenant.id, cartRow.id, input.locale);
      }
      // Limit hit mid-turn (after tool steps already ran): what the model said so far, else the limited copy.
      const limitedCopy = limitedBy
        ? input.requestType === "console_preview"
          ? AI_LIMITED_PREVIEW_REPLY
          : (AI_LIMITED_CUSTOMER_REPLY[input.locale] ?? AI_LIMITED_CUSTOMER_REPLY.en).plain
        : null;
      return {
        handledBy: "ai",
        reply: finalText || limitedCopy || "Sorry, I didn't catch that — could you rephrase?",
        provider: row.provider,
        model: row.model,
        costUsd,
        fallbackUsed: i > 0,
        cart,
      };
    }

    lastError = stepError;
    lastModel = { provider: row.provider, model: row.model };
  }

  if (limitedBy) return limitedResult(limitedBy);

  // Recorded with the last model tried: the ledger rejects an "ai" row without a
  // provider/model, which is how these failures used to disappear silently.
  await recordInteraction(supabase, {
    tenantId: input.tenant.id,
    requestType: input.requestType,
    handledBy: "ai",
    provider: lastModel?.provider,
    model: lastModel?.model,
    success: false,
    fallbackUsed: chain.length > 1,
    errorMessage: lastError,
  });
  // Still useful without the model: the real products this message is about, as cards.
  if (relevant.length > 0) {
    return {
      handledBy: "ai",
      reply: "I can't give you a personal recommendation right now, but here's what we have that matches:",
      error: lastError,
      productIds: relevant.slice(0, 8).map((p) => p.id),
    };
  }
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
  const { error } = await supabase.rpc("record_agent_interaction", {
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
    p_error_message: params.errorMessage ? params.errorMessage.slice(0, 1000) : null,
  });
  if (error) agentLog("ledger_error", { tenant_id: params.tenantId, error_code: error.code ?? "UNKNOWN" });
}
