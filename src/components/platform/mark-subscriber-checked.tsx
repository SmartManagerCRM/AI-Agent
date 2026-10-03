"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { markSubscriberCheckedAction } from "@/server/platform/subscriber-checks";

/** Opening a subscriber's page checks it: the sidebar number goes down at once. */
export function MarkSubscriberChecked({ locale, tenantId }: { locale: string; tenantId: string }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void markSubscriberCheckedAction({ locale, tenantId }).then((changed) => {
      if (!cancelled && changed) router.refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [locale, tenantId, router]);
  return null;
}
