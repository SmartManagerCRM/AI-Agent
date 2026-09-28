"use client";

import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { updateAgentSettingsAction } from "@/server/ai/actions";

type Props = {
  tenantId: string;
  slug: string;
  locale: string;
  current: { active: boolean; assistant_name: string | null; greeting: string | null; tone: string | null };
};

export function AgentSettingsForm({ tenantId, slug, locale, current }: Props) {
  const [error, formAction, pending] = useActionState(updateAgentSettingsAction, undefined);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={current.active} />
        Agent active
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Assistant name
        <input
          name="assistantName"
          defaultValue={current.assistant_name ?? ""}
          maxLength={80}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Greeting
        <input
          name="greeting"
          defaultValue={current.greeting ?? ""}
          maxLength={300}
          className="rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Tone
        <select name="tone" defaultValue={current.tone ?? "friendly"} className="rounded-md border border-neutral-300 px-3 py-2">
          <option value="friendly">Friendly</option>
          <option value="formal">Formal</option>
          <option value="playful">Playful</option>
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={pending} className="w-fit">
        Save
      </Button>
    </form>
  );
}
