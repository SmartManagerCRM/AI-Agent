"use client";

import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { pauseAgentAction, publishAgentAction } from "@/server/agent-public/go-live-actions";

function Message({ state }: { state: { ok: boolean; message: string } | undefined }) {
  if (!state) return null;
  return (
    <p role="status" className={`basis-full text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>
      {state.message}
    </p>
  );
}

export function PublishAgentForm({
  slug,
  locale,
  canPublish,
  importable,
  label,
}: {
  slug: string;
  locale: string;
  canPublish: boolean;
  /** Approved, readable, priced Brain products that can be added to the catalog now. */
  importable: number;
  label: string;
}) {
  const [state, formAction, pending] = useActionState(publishAgentAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      {importable > 0 && (
        <label className="flex basis-full items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="importProducts" defaultChecked className="h-4 w-4 rounded border-slate-300" />
          Add the {importable} approved product(s) with prices to my catalog so customers can order them
        </label>
      )}
      <Button type="submit" disabled={!canPublish || pending} data-testid="publish-agent">
        {pending ? "Publishing…" : label}
      </Button>
      <Message state={state} />
    </form>
  );
}

export function PauseAgentForm({ slug, locale }: { slug: string; locale: string }) {
  const [state, formAction, pending] = useActionState(pauseAgentAction, undefined);
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm("Pause your Agent? Customers will see “temporarily unavailable” until you publish again.")) e.preventDefault();
      }}
      className="contents"
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="danger" disabled={pending} className="px-3 py-1.5 text-xs" data-testid="pause-agent">
        {pending ? "Pausing…" : "Pause Agent"}
      </Button>
      <Message state={state} />
    </form>
  );
}
