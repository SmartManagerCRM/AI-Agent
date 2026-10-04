import { redirect } from "next/navigation";

import { isSuperAdmin, myTenantMemberships, requireUser } from "@/server/tenant/context";

/**
 * Entry point after sign-in (`/<locale>/subscriber`): routes a signed-in
 * owner to their business; a Super Admin without one to Super Admin; someone
 * who signed up on the website but hasn't finished (confirmed their email
 * first) to Welcome, which creates the business on the plan they chose;
 * anyone else to onboarding.
 */
export default async function ConsoleEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await requireUser(locale);
  const memberships = await myTenantMemberships();

  if (memberships.length === 0) {
    if (await isSuperAdmin(user.id)) redirect(`/${locale}/super-admin`);
    const pending = user.user_metadata?.pending_signup;
    if (pending && typeof pending === "object") redirect(`/${locale}/welcome`);
    redirect(`/${locale}/onboarding`);
  }
  // External path (this redirect issues a fresh request through
  // src/proxy.ts's host-based rewrite, which adds its own "/console"
  // prefix internally) — a pre-existing bug found while building Phase 8's
  // invite-accept flow, which redirects through this exact entry point.
  redirect(`/${locale}/${memberships[0].slug}`);
}
