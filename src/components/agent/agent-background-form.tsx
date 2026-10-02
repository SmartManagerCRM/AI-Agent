"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/console/button";
import { updateAgentBackgroundAction } from "@/server/ai/actions";

/**
 * Agent settings → Background photo: the picture shown behind the whole
 * customer Agent (landing page under a dark wash, other screens softly).
 */
export function AgentBackgroundForm({ slug, locale, currentUrl }: { slug: string; locale: string; currentUrl: string | null }) {
  const [state, formAction, pending] = useActionState(updateAgentBackgroundAction, undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const shown = preview ?? currentUrl;

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="agent-background-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        {/* A phone-shaped preview, as customers will see it. */}
        <div
          className="relative flex h-44 w-24 shrink-0 items-end overflow-hidden rounded-2xl bg-slate-100 bg-cover bg-center ring-1 ring-slate-200"
          style={shown ? { backgroundImage: `url("${encodeURI(shown)}")` } : undefined}
          aria-label={shown ? "Current background photo" : "No background photo yet"}
          role="img"
        >
          {shown ? (
            <span className="w-full bg-gradient-to-t from-black/70 to-transparent px-2 pt-6 pb-2 text-[10px] font-semibold text-white">Your Agent</span>
          ) : (
            <span className="w-full px-2 pb-3 text-center text-[11px] text-slate-400">No photo</span>
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-slate-600">
          <p>
            A photo of your place, shown behind your whole Agent — like the customers&apos; first look through your door. JPG, PNG or
            WebP, up to 6 MB; a tall or wide photo of your interior works best.
          </p>
          <input
            type="file"
            name="photo"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              setPreview(file ? URL.createObjectURL(file) : null);
            }}
            className="text-sm file:me-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            aria-label="Background photo"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : currentUrl ? "Replace background photo" : "Add background photo"}
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
      </div>
    </form>
  );
}
