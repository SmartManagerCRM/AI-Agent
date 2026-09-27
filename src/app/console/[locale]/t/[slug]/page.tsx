import { getTranslations } from "next-intl/server";

import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function TenantDashboard({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant, membership } = await requireTenantMember(locale, slug);
  const t = await getTranslations("console");
  const supabase = await createUserClient();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at")
    .eq("tenant_id", tenant.id)
    .maybeSingle();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">{tenant.business_name[locale] ?? tenant.slug}</h1>
      <dl className="grid max-w-md grid-cols-2 gap-y-2 text-sm">
        <dt className="text-neutral-500">Status</dt>
        <dd className="capitalize">{tenant.status}</dd>
        <dt className="text-neutral-500">Your role</dt>
        <dd className="capitalize">{membership.role_key.replace("_", " ")}</dd>
        <dt className="text-neutral-500">Currency</dt>
        <dd>{tenant.currency}</dd>
        {subscription && (
          <>
            <dt className="text-neutral-500">Subscription</dt>
            <dd className="capitalize">
              {subscription.status.replace("_", " ")}
              {subscription.status === "trialing" &&
                ` — trial ends ${new Date(subscription.trial_ends_at).toLocaleDateString(locale)}`}
            </dd>
          </>
        )}
      </dl>
      <p className="max-w-md rounded-md border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500">
        {t("comingSoon")}
      </p>
    </div>
  );
}
