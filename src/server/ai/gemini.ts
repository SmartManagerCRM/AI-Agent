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
 * Google AI Studio (Gemini) REST provider — paid tier (the platform's own
 * account, metered per tenant via `agent_interactions`; see
 * ARCHITECTURE_ASSESSMENT.md §10). Called directly by `fetch`, no vendor SDK
 * dependency, consistent with the rest of this codebase's integration style.
 * The API key is added as `GEMINI_API_KEY` at deploy time — this file never
 * assumes a free-tier quota.
 *
 * No `import "server-only"` here (unlike `gateway.ts`): this module is
 * imported directly by its own unit tests, and the guard's throwing stub
 * only resolves away under Next's `react-server` bundler condition, not
 * under Vitest. It reads `@/server/env-core` (unguarded) rather than
 * `@/server/env` for the same reason. Nothing here is reachable from a
 * client bundle regardless — every caller in this codebase is itself
 * server-only.
 */
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export function geminiConfigured(): boolean {
  return Boolean(serverEnv().GEMINI_API_KEY);
}

export const geminiProvider: AIProvider = {
  configured: geminiConfigured,
  chat: (input) => geminiChat(input),
};

async function geminiChat(input: ChatInput): Promise<AIProviderResult<ChatResult>> {
  const apiKey = serverEnv().GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "NOT_CONFIGURED: GEMINI_API_KEY is not set." };

  const body: Record<string, unknown> = {
    contents: input.messages.map(toGeminiContent),
    systemInstruction: { parts: [{ text: input.system }] },
    generationConfig: { maxOutputTokens: input.maxTokens ?? 1024 },
  };
  if (input.tools?.length) {
    body.tools = [{ functionDeclarations: input.tools.map(toGeminiFunctionDeclaration) }];
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/models/${encodeURIComponent(input.model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    });
  } catch (error) {
    return { ok: false, error: `NETWORK_ERROR: ${error instanceof Error ? error.message : "request failed"}` };
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return { ok: false, error: `AI_PROVIDER_ERROR: Gemini responded ${response.status}: ${text.slice(0, 500)}` };
  }

  const data: unknown = await response.json().catch(() => null);
  if (!data || typeof data !== "object") return { ok: false, error: "AI_PROVIDER_ERROR: malformed Gemini response." };
  return { ok: true, value: parseGeminiResponse(data as GeminiResponse) };
}

type GeminiPart = {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  inlineData?: { mimeType: string; data: string };
};
type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

function toGeminiContent(message: AITurnMessage): { role: "user" | "model"; parts: GeminiPart[] } {
  const parts: GeminiPart[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push({ text: block.text });
    else if (block.type === "image") parts.push({ inlineData: { mimeType: block.mediaType, data: block.data } });
    else if (block.type === "tool_use") parts.push({ functionCall: { name: block.name, args: block.input } });
    else if (block.type === "tool_result") {
      parts.push({ text: `[tool result for ${block.toolUseId}]: ${block.content}` });
    }
  }
  return { role: message.role === "assistant" ? "model" : "user", parts };
}

function toGeminiFunctionDeclaration(tool: AIToolDefinition) {
  return { name: tool.name, description: tool.description, parameters: tool.parameters };
}

function parseGeminiResponse(data: GeminiResponse): ChatResult {
  const candidate = data.candidates?.[0];
  const content: ContentBlock[] = [];
  let toolCallIndex = 0;
  for (const part of candidate?.content?.parts ?? []) {
    if (part.text) content.push({ type: "text", text: part.text });
    else if (part.functionCall) {
      // Gemini matches a function response to a call by name, not id — the
      // synthetic id below carries the name so a future tool-calling loop
      // (Phase 4) can round-trip it without Gemini-specific logic elsewhere.
      content.push({
        type: "tool_use",
        id: `g_${toolCallIndex++}_${part.functionCall.name}`,
        name: part.functionCall.name,
        input: part.functionCall.args ?? {},
      });
    }
  }

  const finishReason = candidate?.finishReason;
  const stopReason: ChatResult["stopReason"] =
    content.some((b) => b.type === "tool_use")
      ? "tool_use"
      : finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : finishReason === "STOP"
          ? "end_turn"
          : "other";

  return {
    content,
    stopReason,
    usage: {
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}
