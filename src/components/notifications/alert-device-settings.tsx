"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/console/button";
import { useAlertDeviceSettings } from "@/components/notifications/notification-center";

/** Settings → "Order alerts on this device": sound on/off, test, keep the screen on. Saved per device. */
export function AlertDeviceSettings() {
const t = useTranslations("console.alertDevice");
  const s = useAlertDeviceSettings();
  const [tested, setTested] = useState(false);
  if (!s) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="alert-device-settings">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">{t("title")}</h2>
      <p className="mb-3 text-xs text-slate-500">
        {t("intro")}
      </p>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>{t("sound")}</span>
          <input type="checkbox" role="switch" checked={s.soundOn} onChange={s.toggle} className="h-5 w-5 accent-emerald-600" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {t("test")}
            {tested && !s.ready && <span className="ms-2 text-xs text-amber-700">{t("volumeUp")}</span>}
          </span>
          <Button
            type="button"
            variant="secondary"
            className="px-3 py-1.5"
            onClick={() => {
              s.testSound();
              setTested(true);
            }}
          >
            {t("play")}
          </Button>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span>
            {t("keepAwake")}
            <span className="block text-xs text-slate-500">
              {s.keepAwakeSupported
                ? t("keepAwakeHint")
                : t("keepAwakeNo")}
            </span>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={s.keepAwake}
            disabled={!s.keepAwakeSupported}
            onChange={(e) => s.setKeepAwake(e.target.checked)}
            className="mt-0.5 h-5 w-5 accent-emerald-600"
          />
        </label>
      </div>
    </section>
  );
}
