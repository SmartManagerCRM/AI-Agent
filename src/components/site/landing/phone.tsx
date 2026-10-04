import Image from "next/image";
import type { ReactNode } from "react";

/**
 * A phone showing the SmartManager AI Agent's chat (an illustration of the
 * product's screens on the landing page — the real Agent is behind "Watch
 * demo").
 */
export function Phone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    // Positioned by the caller (className): no `position` here, so `absolute …` always applies.
    <div className={`rounded-[2.6rem] bg-[#0d1424] p-[9px] shadow-[0_40px_80px_-30px_rgba(12,26,51,0.55)] ring-1 ring-black/40 ${className}`}>
      <div className="relative flex h-full flex-col overflow-hidden rounded-[2.1rem] bg-white">
        <div className="absolute start-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-[#0d1424] rtl:translate-x-1/2" aria-hidden />
        {children}
      </div>
    </div>
  );
}

export function PhoneAgentBar({ title, online, onClose = true }: { title: string; online: string; onClose?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 pb-3 pt-8">
      <Image src="/brand/agent-avatar.png" alt="" width={34} height={34} className="rounded-full ring-2 ring-emerald-100" />
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-[11px] font-bold tracking-tight text-slate-900">{title}</p>
        <p className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          {online}
        </p>
      </div>
      {onClose && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-700 text-[11px] font-bold text-white" aria-hidden>
          ×
        </span>
      )}
    </div>
  );
}
