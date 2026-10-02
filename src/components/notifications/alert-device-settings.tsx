"use client";

import { useState } from "react";

import { Button } from "@/components/console/button";
import { useAlertDeviceSettings } from "@/components/notifications/notification-center";

/** Settings → "Order alerts on this device": sound on/off, test, keep the screen on. Saved per device. */
export function AlertDeviceSettings() {
  const s = useAlertDeviceSettings();
  const [tested, setTested] = useState(false);
  if (!s) return null;
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="alert-device-settings">
      <h2 className="mb-1 text-sm font-semibold text-slate-900">Order alerts on this device</h2>
      <p className="mb-3 text-xs text-slate-500">
        While this console is open on screen, every new order plays the order sound. When the phone is locked or
        another app is in front, browsers don&apos;t let any website play its own sound — you&apos;ll get a notification
        with your phone&apos;s sound and vibration instead, and the order sound plays as soon as you come back.
      </p>
      <div className="flex flex-col gap-3 text-sm">
        <label className="flex items-center justify-between gap-3">
          <span>Order sound</span>
          <input type="checkbox" role="switch" checked={s.soundOn} onChange={s.toggle} className="h-5 w-5 accent-emerald-600" />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Test the sound on this device
            {tested && !s.ready && <span className="ms-2 text-xs text-amber-700">Turn the volume up and tap again.</span>}
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
            Play test sound
          </Button>
        </div>
        <label className="flex items-start justify-between gap-3">
          <span>
            Keep the screen on while the console is open
            <span className="block text-xs text-slate-500">
              {s.keepAwakeSupported
                ? "For a phone or tablet at the counter: the console stays in front, so the order sound always plays. Uses more battery — best when charging."
                : "This browser can't keep the screen on."}
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
