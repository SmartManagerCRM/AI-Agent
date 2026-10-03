"use client";

import { useActionState } from "react";

import { EMPTY_SERVICE, ServiceFields } from "@/components/console/service-fields";
import { createServiceAction } from "@/server/booking/actions";

type Props = { tenantId: string; slug: string; locale: string; currencyExponent: number };

export function CreateServiceForm({ tenantId, slug, locale, currencyExponent }: Props) {
  const [error, formAction, pending] = useActionState(createServiceAction, undefined);

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="create-service-form">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="locale" value={locale} />
      <ServiceFields values={EMPTY_SERVICE} exponent={currencyExponent} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? "Adding…" : "Add service"}
        </button>
      </div>
    </form>
  );
}
