import { redirect } from "next/navigation";

import { myTenantMemberships, requireUser } from "@/server/tenant/context";

/** Entry point: routes a signed-in owner to their business, or to onboarding. */
export default async function ConsoleEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireUser(locale);
  const memberships = await myTenantMemberships();

  if (memberships.length === 0) redirect(`/${locale}/onboarding`);
  // External path (this redirect issues a fresh request through
  // src/proxy.ts's host-based rewrite, which adds its own "/console"
  // prefix internally) — a pre-existing bug found while building Phase 8's
  // invite-accept flow, which redirects through this exact entry point.
  redirect(`/${locale}/t/${memberships[0].slug}`);
}
