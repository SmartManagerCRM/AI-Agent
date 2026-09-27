/**
 * The Agent Engine's channel-agnostic contract.
 *
 * `runAgentGateway` (`src/server/ai/gateway.ts`) takes and returns plain
 * text — deliberately. Business Brain, the tool registry, and every
 * commerce module (cart/orders/payments/fulfillment) operate on structured
 * data and know nothing about how a message reached the agent or how the
 * reply will be delivered. That boundary is what makes voice addable
 * later as a pure I/O adapter:
 *
 *   voice in  →  speech-to-text  →  runAgentGateway(text)  →  reply (text)  →  text-to-speech  →  voice out
 *
 * Only the adapter at the edges changes. `AgentModality` records which
 * edge produced/consumed a given message (`conversation_messages.modality`)
 * so analytics and a future voice channel can tell them apart — it is
 * metadata about delivery, not an input to the gateway, the tools, or any
 * commerce module, none of which read it or ever should.
 *
 * MVP ships `"text"` only; `"voice"` is reserved so adding it is a new
 * adapter and a new value, never a schema or interface change here.
 */
export type AgentModality = "text" | "voice";

export const AGENT_MODALITY_TEXT: AgentModality = "text";
