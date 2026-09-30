"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/console/button";
import {
  cancelDiscoveryAction,
  getDiscoveryProgressAction,
  startDiscoveryAction,
  type DiscoveryProgress,
} from "@/server/brain/actions";

type Props = {
  slug: string;
  locale: string;
  placesAvailable: boolean;
  defaults: { mapsInput: string; websiteUrl: string };
  activeJobId: string | null;
  hasRunBefore: boolean;
};

const STEPS = ["Your listing", "Your website", "Analyze", "Review", "Go live"];

const STAGES: { status: string; label: string }[] = [
  { status: "discovering", label: "Finding your business" },
  { status: "fetching", label: "Reading your website" },
  { status: "extracting", label: "Extracting details" },
  { status: "ai_processing", label: "Reading what rules couldn't" },
  { status: "normalizing", label: "Organizing facts" },
  { status: "conflict_check", label: "Checking for conflicts" },
];
const ORDER = ["created", "discovering", "fetching", "extracting", "ai_processing", "normalizing", "validating", "conflict_check"];
const RUNNING = new Set(ORDER);

export function DiscoveryPanel({ slug, locale, placesAvailable, defaults, activeJobId, hasRunBefore }: Props) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(startDiscoveryAction, undefined);
  const jobId = state?.jobId ?? activeJobId;
  const [progress, setProgress] = useState<DiscoveryProgress | null>(null);

  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    const tick = async () => {
      const next = await getDiscoveryProgressAction(locale, slug, jobId).catch(() => null);
      if (stopped || !next) return;
      setProgress(next);
      if (!RUNNING.has(next.status)) {
        stopped = true;
        router.refresh();
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [jobId, locale, slug, router]);

  const running = Boolean(jobId) && (progress === null || RUNNING.has(progress.status));
  const currentStep = running ? 2 : hasRunBefore ? 3 : 0;

  return (
    <section className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">Analyze my business</h2>
        <p className="text-sm text-slate-600">
          Point SmartManager at your Google Maps listing and/or website. It reads them, organizes what it finds, and asks you
          to confirm — nothing reaches your customers until you approve it. No website? That&apos;s fine.
        </p>
      </div>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
              i === currentStep
                ? "border-emerald-500 bg-emerald-600 text-white"
                : i < currentStep
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-slate-200 bg-white text-slate-500"
            }`}
          >
            <span className="font-semibold">{i + 1}</span> {label}
          </li>
        ))}
      </ol>

      {running ? (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4" aria-live="polite">
          <ul className="flex flex-col gap-2 text-sm">
            {STAGES.map((stage) => {
              const at = progress ? ORDER.indexOf(progress.status) : 0;
              const mine = ORDER.indexOf(stage.status);
              const done = at > mine;
              const active = at === mine || (stage.status === "conflict_check" && progress?.status === "validating");
              return (
                <li key={stage.status} className="flex items-center gap-2">
                  <span
                    className={`inline-flex size-4 items-center justify-center rounded-full text-[10px] ${
                      done ? "bg-emerald-600 text-white" : active ? "animate-pulse bg-emerald-200" : "bg-slate-200"
                    }`}
                    aria-hidden
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span className={done ? "text-slate-500" : active ? "font-medium text-slate-900" : "text-slate-400"}>{stage.label}</span>
                </li>
              );
            })}
          </ul>
          {progress && progress.events.length > 0 && (
            <ul className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {progress.events.slice(-4).map((e, i) => (
                <li key={i} className={e.level === "error" ? "text-red-600" : e.level === "warning" ? "text-amber-700" : ""}>
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <form action={cancelDiscoveryAction} className="mt-3">
            <input type="hidden" name="jobId" value={jobId ?? ""} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
              Cancel analysis
            </button>
          </form>
        </div>
      ) : (
        <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="locale" value={locale} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800">Google Maps listing</span>
            <input
              name="mapsInput"
              defaultValue={defaults.mapsInput}
              disabled={!placesAvailable}
              placeholder={placesAvailable ? "Maps link, or business name + city" : "Not available yet"}
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
            />
            <span className="text-xs text-slate-500">
              {placesAvailable
                ? "Share → Copy link in Google Maps. Read through Google's official Places API."
                : "Google Maps import isn't configured on this platform yet — use your website or add details by hand."}
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800">Website (optional)</span>
            <input
              name="websiteUrl"
              defaultValue={defaults.websiteUrl}
              placeholder="https://yourbusiness.com"
              inputMode="url"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <span className="text-xs text-slate-500">We read public pages only and respect your site&apos;s robots.txt.</span>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Starting…" : hasRunBefore ? "Analyze again" : "Analyze my business"}
            </Button>
            {hasRunBefore && <span className="text-xs text-slate-500">Unchanged pages are skipped automatically.</span>}
            {state?.error && <p className="basis-full text-sm text-red-600">{state.error}</p>}
          </div>
        </form>
      )}
      {!running && progress?.status === "cancelled" && <p className="mt-2 text-xs text-slate-500">Analysis cancelled.</p>}
    </section>
  );
}
