"use client";

import { useTranslations } from "next-intl";
import { useActionState } from "react";

import { Button } from "@/components/console/button";
import { syncBrainCatalogAction } from "@/server/catalog/actions";

/** "Add from Business Brain": brings in every product / service the Brain found that isn't listed yet. */
export function BrainSyncButton({ slug, locale }: { slug: string; locale: string }) {
  const t = useTranslations("console.catalogForms");
  const tCommon = useTranslations("common");
  const [state, formAction, pending] = useActionState(syncBrainCatalogAction, undefined);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3" data-testid="brain-sync-form">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" variant="secondary" disabled={pending} className="px-3 py-1.5">
        {pending ? tCommon("adding") : t("addFromBrain")}
      </Button>
      {state && (
        <p role="status" className={`text-xs ${state.ok ? "text-emerald-700" : "text-amber-800"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
