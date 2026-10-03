"use client";

import { useTranslations } from "next-intl";
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
  defaults: { mapsInput: string; websiteUrl: string; menuUrls: string };
  activeJobId: string | null;
  hasRunBefore: boolean;
  /** The Agent is published — the last step ("Go live") is done. */
  isLive?: boolean;
};

const STEPS = ["listing", "website", "analyze", "review", "live"];

const STAGES = ["discovering", "fetching", "extracting", "ai_processing", "normalizing", "conflict_check"].map(
  (status) => ({ status }),
);
const ORDER = [
  "created",
  "discovering",
  "fetching",
  "extracting",
  "ai_processing",
  "normalizing",
  "validating",
  "conflict_check",
];
const RUNNING = new Set(ORDER);

export function DiscoveryPanel({
  slug,
  locale,
  placesAvailable,
  defaults,
  activeJobId,
  hasRunBefore,
  isLive = false,
}: Props) {
  const t = useTranslations("console.discovery");
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
  // Past "Review" once the Agent is published (every step done).
  const currentStep = running ? 2 : isLive ? STEPS.length : hasRunBefore ? 3 : 0;

  return (
    <section className="rounded-xl border border-emerald-200 bg-gradient-to-b from-emerald-50/60 to-white p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-slate-900">{t("title")}</h2>
        <p className="text-sm text-slate-600">{t("intro")}</p>
      </div>

      <ol className="mt-4 flex flex-wrap gap-2 text-xs" aria-label={t("steps")}>
        {STEPS.map((step, i) => {
          const label = t(`step.${step}`);
          return (
            <li
              key={step}
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
                i === currentStep
                  ? "border-emerald-500 bg-emerald-600 text-white"
                  : i < currentStep
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-slate-200 bg-white text-slate-500"
              }`}
            >
              <span className="font-semibold">{i < currentStep ? "✓" : i + 1}</span>{" "}
              {i === STEPS.length - 1 ? (
                <a href="#go-live" className="hover:underline">
                  {label}
                </a>
              ) : (
                label
              )}
            </li>
          );
        })}
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
                  <span className={done ? "text-slate-500" : active ? "font-medium text-slate-900" : "text-slate-400"}>
                    {t(`stage.${stage.status}`)}
                  </span>
                </li>
              );
            })}
          </ul>
          {progress && progress.events.length > 0 && (
            <ul className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              {progress.events.slice(-4).map((e, i) => (
                <li
                  key={i}
                  className={e.level === "error" ? "text-red-600" : e.level === "warning" ? "text-amber-700" : ""}
                >
                  {e.i18n && t.has(`event.${e.i18n.key}`) ? t(`event.${e.i18n.key}`, e.i18n.values) : e.message}
                </li>
              ))}
            </ul>
          )}
          <form action={cancelDiscoveryAction} className="mt-3">
            <input type="hidden" name="jobId" value={jobId ?? ""} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="locale" value={locale} />
            <button type="submit" className="text-xs font-medium text-slate-500 hover:underline">
              {t("cancel")}
            </button>
          </form>
        </div>
      ) : (
        <form action={formAction} className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="locale" value={locale} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800">{t("maps")}</span>
            <input
              name="mapsInput"
              defaultValue={defaults.mapsInput}
              disabled={!placesAvailable}
              placeholder={placesAvailable ? t("mapsPlaceholder") : t("notAvailable")}
              className="rounded-lg border border-slate-300 px-3 py-2 disabled:bg-slate-50"
            />
            <span className="text-xs text-slate-500">{placesAvailable ? t("mapsHint") : t("mapsOff")}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-slate-800">{t("website")}</span>
            <input
              name="websiteUrl"
              defaultValue={defaults.websiteUrl}
              placeholder="https://yourbusiness.com"
              inputMode="url"
              className="rounded-lg border border-slate-300 px-3 py-2"
            />
            <span className="text-xs text-slate-500">{t("websiteHint")}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-slate-800">{t("menus")}</span>
            <textarea
              name="menuUrls"
              defaultValue={defaults.menuUrls}
              rows={2}
              placeholder={"https://yourbusiness.com/menu\nhttps://yourbusiness.com/breakfast"}
              className="rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
            />
            <span className="text-xs text-slate-500">{t("menusHint")}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? t("starting") : hasRunBefore ? t("again") : t("title")}
            </Button>
            {hasRunBefore && <span className="text-xs text-slate-500">{t("skipped")}</span>}
            {state?.error && <p className="basis-full text-sm text-red-600">{state.error}</p>}
          </div>
        </form>
      )}
      {!running && progress?.status === "cancelled" && <p className="mt-2 text-xs text-slate-500">{t("cancelled")}</p>}
    </section>
  );
}
