"use client";

import { useFormStatus } from "react-dom";

import { Button } from "@/components/console/button";

/** The upgrade's "Pay and upgrade" button: disabled while the payment is processed, so it is charged once. */
export function PaySubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} aria-busy={pending} data-testid="pay-upgrade" className="w-full sm:w-auto">
      {pending ? pendingLabel : label}
    </Button>
  );
}
