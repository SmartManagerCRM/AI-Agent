import Image from "next/image";

type Props = { size?: number; online?: boolean; className?: string };

/**
 * Persistent AI identity mark — the approved SmartManager AI Agent
 * character (public/brand/agent-avatar.png, cut from logo-full.png), the
 * same face in the home greeting, the conversation header and every AI
 * message, so the assistant reads as one consistent employee. Decorative:
 * the assistant's name is always rendered as text next to it.
 */
export function AgentAvatar({ size = 40, online = false, className = "" }: Props) {
  return (
    <span className={`relative inline-flex shrink-0 ${className}`} style={{ width: size, height: size }}>
      <span className="block h-full w-full overflow-hidden rounded-full bg-agent-100 ring-1 ring-agent-200/70">
        <Image src="/brand/agent-avatar.png" alt="" width={size * 2} height={size * 2} className="h-full w-full object-cover" />
      </span>
      {online && (
        <span className="absolute -end-0.5 bottom-0 h-3 w-3 rounded-full border-2 border-white bg-agent-400" aria-hidden="true" />
      )}
    </span>
  );
}
