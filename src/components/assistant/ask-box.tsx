"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { askBusinessAction, type AskAnswer } from "@/server/assistant/ask";

const SUGGESTIONS = ["Sales today", "Orders this week", "Best sellers this month", "Pending orders", "Bookings today", "Members renewing soon", "Is my Agent live?"];

/**
 * Dashboard → Ask SmartManager: questions about the business, answered from
 * its own data with no AI (and so no AI cost). English, Arabic or French.
 */
export function AskBox({ locale, slug, placeholder }: { locale: string; slug: string; placeholder: string }) {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<{ q: string; a: AskAnswer }[]>([]);
  const [pending, startTransition] = useTransition();

  const ask = (q: string) => {
    const text = q.trim();
    if (!text) return;
    startTransition(async () => {
      const a = await askBusinessAction({ locale, slug, question: text });
      if (a) setHistory((h) => [{ q: text, a }, ...h].slice(0, 4));
      setQuestion("");
    });
  };

  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-3" data-testid="ask-box">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(question);
        }}
        className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={placeholder}
          maxLength={300}
          aria-label={placeholder}
          className="min-w-0 flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
        <span className="hidden shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 sm:inline" title="Answered from your own data — no AI is used, so it costs nothing.">
          Free · no AI
        </span>
        <button type="submit" disabled={pending || !question.trim()} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {pending ? "…" : "Ask"}
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => ask(s)} disabled={pending} className="rounded-full bg-white/80 px-3 py-1 text-xs text-slate-600 ring-1 ring-slate-200 hover:bg-white hover:text-slate-900">
            {s}
          </button>
        ))}
      </div>
      {history.map(({ q, a }, i) => (
        <div
          key={`${i}-${q}`}
          dir={a.lang === "ar" ? "rtl" : "ltr"}
          lang={a.lang}
          className={`rounded-xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 ${i > 0 ? "opacity-70" : ""}`}
          data-testid="ask-answer"
        >
          <p className="mb-1 text-xs font-medium text-slate-400">{q}</p>
          {a.lines.map((line, k) => (
            <p key={k} className={line.startsWith("•") || /^\d+\./.test(line) ? "ps-2 text-slate-700" : "text-slate-900"}>
              {line}
            </p>
          ))}
          {a.links.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-3">
              {a.links.map((l) => (
                <Link key={l.href} href={l.href} prefetch={false} className="text-xs font-medium text-emerald-700 hover:underline">
                  {l.label} →
                </Link>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
