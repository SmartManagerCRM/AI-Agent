import { redirect } from "next/navigation";

import { myTenantMemberships, requireUser } from "@/server/tenant/context";

/** Entry point: routes a signed-in owner to their business, or to onboarding. */
export default async function ConsoleEntry({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireUser(locale);
  const memberships = await myTenantMemberships();

  if (memberships.length === 0) redirect(`/${locale}/onboarding`);
  redirect(`/${locale}/console/t/${memberships[0].slug}`);
}
