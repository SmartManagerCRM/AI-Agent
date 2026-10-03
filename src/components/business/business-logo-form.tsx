"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/console/button";
import { updateBusinessLogoAction } from "@/server/business/actions";

/** Settings → Logo: the business's own logo, shown beside its name in the console and on the customer Agent. */
export function BusinessLogoForm({
  slug,
  locale,
  businessName,
  currentUrl,
}: {
  slug: string;
  locale: string;
  businessName: string;
  currentUrl: string | null;
}) {
  const [state, formAction, pending] = useActionState(updateBusinessLogoAction, undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? currentUrl;

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-start" data-testid="business-logo-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      {/* How it looks beside the business name (the console sidebar). */}
      <div className="flex w-full max-w-60 shrink-0 items-center gap-2 rounded-xl bg-slate-900 p-3">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview (blob:) or the stored logo
          <img src={shown} alt="" className="h-10 w-10 shrink-0 rounded-lg bg-white object-contain p-0.5" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-base font-bold text-white">
            {businessName.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 truncate text-sm font-semibold text-white">{businessName}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-slate-600">
        <p>
          Your logo appears next to your business name in this console and on your customer Agent. PNG, JPG or WebP, up to 3 MB; a
          square logo with a transparent background looks best.
        </p>
        <input
          type="file"
          name="logo"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const file = e.target.files?.[0];
            setPreview(file ? URL.createObjectURL(file) : null);
          }}
          className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
          aria-label="Logo"
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : currentUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {currentUrl && (
            <Button type="submit" variant="secondary" name="remove" value="on" disabled={pending}>
              Remove
            </Button>
          )}
        </div>
        {state && (
          <p role="status" className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
