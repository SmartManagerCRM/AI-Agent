"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/console/button";

/**
 * Paddle's checkout (Paddle.js, overlay). The card form is Paddle's own,
 * on Paddle's domain — card details never reach this app. Completing it
 * doesn't activate anything here by itself: Paddle's signed webhook does
 * (src/server/billing/paddle/webhook.ts); this page only waits for it,
 * refreshing until the payment shows as received.
 *
 * mode "console": opens the given transaction (the Billing page's checkout).
 * mode "link":    the default payment link (/checkout?_ptxn=…) that Paddle's
 *                 own emails point to — Paddle.js opens that transaction itself.
 */
type PaddleEvent = { name?: string };
type PaddleGlobal = {
  Environment: { set(env: string): void };
  Initialize(options: { token: string; eventCallback?: (event: PaddleEvent) => void; checkout?: { settings?: Record<string, unknown> } }): void;
  Checkout: { open(options: Record<string, unknown>): void };
};
declare global {
  interface Window {
    Paddle?: PaddleGlobal;
  }
}

const PADDLE_JS = "https://cdn.paddle.com/paddle/v2/paddle.js";
let loading: Promise<PaddleGlobal> | null = null;

function loadPaddle(): Promise<PaddleGlobal> {
  if (window.Paddle) return Promise.resolve(window.Paddle);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PADDLE_JS;
    script.async = true;
    script.onload = () => (window.Paddle ? resolve(window.Paddle) : reject(new Error("Paddle.js unavailable")));
    script.onerror = () => {
      loading = null;
      reject(new Error("Paddle.js unavailable"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export function PaddleCheckout({
  clientToken,
  environment,
  locale,
  mode,
  transactionId,
  email,
}: {
  clientToken: string;
  environment: "sandbox" | "production";
  locale: string;
  mode: "console" | "link";
  transactionId?: string;
  email?: string | null;
}) {
  const t = useTranslations("console.paddle");
  const router = useRouter();
  const [state, setState] = useState<"loading" | "open" | "closed" | "completed" | "unavailable">("loading");
  const initialized = useRef(false);

  /** Initializes Paddle.js once, then opens the checkout (console mode). */
  const start = useCallback(
    (paddle: PaddleGlobal) => {
      if (!initialized.current) {
        if (environment === "sandbox") paddle.Environment.set("sandbox");
        paddle.Initialize({
          token: clientToken,
          checkout: { settings: { displayMode: "overlay", theme: "light", locale, allowLogout: false } },
          eventCallback: (event) => {
            if (event.name === "checkout.completed") setState("completed");
            else if (event.name === "checkout.closed") setState((s) => (s === "completed" ? s : "closed"));
            else if (event.name === "checkout.loaded") setState("open");
          },
        });
        initialized.current = true;
      }
      // In "link" mode Paddle.js opens the transaction named in the URL (?_ptxn=…) on its own.
      if (mode === "console" && transactionId) {
        paddle.Checkout.open({ transactionId, ...(email ? { customer: { email } } : {}) });
      }
    },
    [clientToken, environment, locale, mode, transactionId, email],
  );

  const open = useCallback(() => {
    loadPaddle().then(start, () => setState("unavailable"));
  }, [start]);

  useEffect(() => {
    let active = true;
    loadPaddle().then(
      (paddle) => active && start(paddle),
      () => active && setState("unavailable"),
    );
    return () => {
      active = false;
    };
  }, [start]);

  // After paying: wait for Paddle's webhook to record it (the page re-renders as "received").
  useEffect(() => {
    if (state !== "completed" || mode !== "console") return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      router.refresh();
      if (tries >= 30) clearInterval(timer);
    }, 2000);
    return () => clearInterval(timer);
  }, [state, mode, router]);

  return (
    <div className="flex flex-col items-center gap-3 text-sm text-slate-600" data-testid="paddle-checkout" data-state={state}>
      {state === "loading" && <p>{t("opening")}</p>}
      {state === "open" && <p>{t("secure")}</p>}
      {state === "completed" && (
        <p className="font-medium text-emerald-700" role="status">
          {mode === "console" ? t("confirming") : t("thanks")}
        </p>
      )}
      {state === "closed" && (
        <>
          <p>{t("closed")}</p>
          {mode === "console" && (
            <Button type="button" onClick={open}>
              {t("reopen")}
            </Button>
          )}
        </>
      )}
      {state === "unavailable" && <p className="text-red-600">{t("unavailable")}</p>}
    </div>
  );
}
