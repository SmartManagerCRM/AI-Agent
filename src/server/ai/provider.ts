/**
 * Provider-agnostic AI interface (spec §5). No file outside `src/server/ai/`
 * should import a vendor SDK or call a model API directly — every caller
 * goes through this shape. Content is block-based (text/tool_use/tool_result)
 * because that is what a real tool-calling turn needs to express; the tool
 * layer itself is a later phase (Phase 4), but the shape is right from day
 * one so adding tools later is not a breaking change here.
 */
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export type AITurnMessage = { role: "user" | "assistant"; content: ContentBlock[] };

export type AIToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type AIUsage = { inputTokens: number; outputTokens: number };

export type ChatInput = {
  /** The specific model to call — always supplied by the router (spec §6), never hard-coded per call site. */
  model: string;
  system: string;
  messages: AITurnMessage[];
  tools?: AIToolDefinition[];
  maxTokens?: number;
};

export type ChatResult = {
  content: ContentBlock[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  usage: AIUsage;
};

export type AIProviderResult<T> = { ok: true; value: T } | { ok: false; error: string };

export type AIProviderKey = "gemini" | "anthropic";

export type AIProvider = {
  /** Whether this provider has the credentials it needs (an env var is set). */
  configured(): boolean;
  /** One model turn. May return text, a tool call, or both. */
  chat(input: ChatInput): Promise<AIProviderResult<ChatResult>>;
};
