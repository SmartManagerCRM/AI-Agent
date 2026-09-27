import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/server/env-core";

import type {
  AIProvider,
  AIProviderResult,
  AIToolDefinition,
  AITurnMessage,
  ChatInput,
  ChatResult,
  ContentBlock,
} from "./provider";

/**
 * Anthropic provider — the second `AIProvider` implementation the
 * abstraction exists for (spec §5), available as the model router's
 * fallback if Gemini (the primary, paid-tier provider per the platform
 * owner's own instruction) fails a call. Uses the official `@anthropic-ai/sdk`
 * rather than raw `fetch`, unlike `gemini.ts` — there is a first-party
 * TypeScript SDK for this provider, so this file uses it.
 *
 * No `import "server-only"` here — same reasoning as `gemini.ts`: this
 * module is imported directly by its own unit tests, and the guard only
 * resolves away under Next's bundler, not under Vitest.
 */
let client: Anthropic | undefined;

export function anthropicConfigured(): boolean {
  return Boolean(serverEnv().ANTHROPIC_API_KEY);
}

export const anthropicProvider: AIProvider = {
  configured: anthropicConfigured,
  chat: (input) => anthropicChat(input),
};

async function anthropicChat(input: ChatInput): Promise<AIProviderResult<ChatResult>> {
  const apiKey = serverEnv().ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "NOT_CONFIGURED: ANTHROPIC_API_KEY is not set." };
  client ??= new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: input.messages.map(toAnthropicMessage),
      tools: input.tools?.map(toAnthropicTool),
      // Disabled: this path serves short, deterministic-fallback customer
      // replies, not open-ended agentic reasoning — keeping thinking off
      // keeps latency/cost predictable. Revisit once Phase 4's tool-calling
      // loop is the caller (thinking + low/medium effort, per the model's
      // own guidance, rather than disabling it once real tools are in play).
      thinking: { type: "disabled" },
    });

    return { ok: true, value: parseAnthropicResponse(response) };
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `AI_PROVIDER_ERROR: Anthropic responded ${error.status}: ${error.message}` };
    }
    return { ok: false, error: `NETWORK_ERROR: ${error instanceof Error ? error.message : "request failed"}` };
  }
}

function toAnthropicMessage(message: AITurnMessage): Anthropic.MessageParam {
  return { role: message.role, content: message.content.map(toAnthropicBlock) };
}

function toAnthropicBlock(block: ContentBlock): Anthropic.ContentBlockParam {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "tool_use") return { type: "tool_use", id: block.id, name: block.name, input: block.input };
  return { type: "tool_result", tool_use_id: block.toolUseId, content: block.content, is_error: block.isError };
}

function toAnthropicTool(tool: AIToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  };
}

function parseAnthropicResponse(response: Anthropic.Message): ChatResult {
  const content: ContentBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text") content.push({ type: "text", text: block.text });
    else if (block.type === "tool_use") {
      content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> });
    }
  }

  const stopReason: ChatResult["stopReason"] =
    response.stop_reason === "tool_use"
      ? "tool_use"
      : response.stop_reason === "max_tokens"
        ? "max_tokens"
        : response.stop_reason === "end_turn"
          ? "end_turn"
          : "other";

  return {
    content,
    stopReason,
    usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
  };
}
