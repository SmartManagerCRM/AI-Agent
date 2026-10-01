import Link from "next/link";
import { notFound } from "next/navigation";

import { BusinessEditForm, SubscriptionEditForm } from "@/components/platform/subscriber-edit-forms";
import { SubscriberUsageOverridesForm } from "@/components/platform/usage-limits-forms";
import { loadPlanAiCostLimits, loadPlatformUsage } from "@/server/platform/usage";
import { USAGE_STATE_STYLE } from "@/server/platform/usage-analytics";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/** ISO timestamp → "YYYY-MM-DDTHH:mm" in UTC for a datetime-local input ("" when none). */
const utcInput = (iso: string | null | undefined) => (iso ? new Date(iso).toISOString().slice(0, 16) : "");

/**
 * Super Admin: edit one subscriber — business profile and owner, the
 * subscription (plan, status, trial end, billing period) and its own usage
 * thresholds. Every write is Super-Admin-only in the database itself.
 */
export default async function EditSubscriberPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const { data: tenant } = await supabase
    .from("tenants")
    .select(
      "id, slug, business_name, business_type_key, status, contact_email, contact_phone, website_url, country, city, timezone, default_language, deployment_mode",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (!tenant) notFound();

  const [
    { data: subscription },
    { data: plans },
    { data: businessTypes },
    { data: settings },
    { data: ownerRole },
    usageRows,
    planAiLimits,
    { data: aiOverride },
  ] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan_key, status, trial_ends_at, current_period_start, current_period_end, conversation_limit_override")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.from("subscription_plans").select("key, name, is_active, conversation_limit").order("sort_order"),
    supabase.from("business_types").select("key, name").order("key"),
    supabase.from("platform_settings").select("supported_languages").eq("id", true).maybeSingle(),
    supabase.from("roles").select("id").is("tenant_id", null).eq("key", "business_owner").maybeSingle(),
    loadPlatformUsage(supabase, tenant.id),
    loadPlanAiCostLimits(supabase),
    supabase.from("ai_cost_limits").select("limit_usd").eq("tenant_id", tenant.id).maybeSingle(),
  ]);
  const usage = usageRows[0] ?? null;
  // Paid-plan thresholds: the plan's defaults and this subscriber's own overrides.
  const plan = (plans ?? []).find((p) => p.key === subscription?.plan_key);
  const planConversationLimit = plan?.conversation_limit ?? null;
  const planAiCostLimit = subscription ? (planAiLimits.get(subscription.plan_key) ?? null) : null;

  let owner: { full_name: string | null; phone: string | null; email: string | null } | null = null;
  if (ownerRole) {
    const { data: member } = await supabase
      .from("tenant_members")
      .select("user_id")
      .eq("tenant_id", tenant.id)
      .eq("role_id", ownerRole.id)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (member) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, phone, email")
        .eq("id", member.user_id)
        .maybeSingle();
      owner = profile ?? null;
    }
  }

  const nameLocale = tenant.business_name[locale] !== undefined ? locale : "en";
  const businessName = tenant.business_name[nameLocale] ?? Object.values(tenant.business_name)[0] ?? tenant.slug;
  const languages = [...new Set([...(settings?.supported_languages ?? ["en", "ar", "fr"]), tenant.default_language])];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/${locale}/super-admin/subscribers`}
            prefetch={false}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            ← Subscribers
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">Edit subscriber: {businessName}</h1>
          <p className="mt-1 text-sm text-slate-500">
            /{tenant.slug}
            {owner?.email && ` · ${owner.email}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {usage && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${USAGE_STATE_STYLE[usage.usageState]}`}>
              {usage.usageState.replace(/_/g, " ")}
            </span>
          )}
          <Link
            href={`/${locale}/super-admin/businesses/${tenant.slug}`}
            prefetch={false}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Business 360
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Business &amp; owner</h2>
        <BusinessEditForm
          locale={locale}
          businessTypes={(businessTypes ?? []).map((t) => ({ value: t.key, label: t.name.en ?? t.key }))}
          languages={languages}
          values={{
            tenantId: tenant.id,
            slug: tenant.slug,
            nameLocale,
            businessName,
            businessTypeKey: tenant.business_type_key,
            status: tenant.status,
            contactEmail: tenant.contact_email ?? "",
            contactPhone: tenant.contact_phone ?? "",
            websiteUrl: tenant.website_url ?? "",
            country: tenant.country ?? "",
            city: tenant.city ?? "",
            timezone: tenant.timezone,
            defaultLanguage: tenant.default_language,
            deploymentMode: tenant.deployment_mode,
            ownerFullName: owner?.full_name ?? "",
            ownerPhone: owner?.phone ?? "",
            ownerEmail: owner?.email ?? "—",
          }}
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Subscription</h2>
        {subscription ? (
          <SubscriptionEditForm
            locale={locale}
            plans={(plans ?? []).map((p) => ({
              value: p.key,
              label: `${p.name.en ?? p.key}${p.is_active ? "" : " (inactive)"}`,
            }))}
            values={{
              tenantId: tenant.id,
              slug: tenant.slug,
              planKey: subscription.plan_key,
              status: subscription.status,
              trialEndsAt: utcInput(subscription.trial_ends_at),
              currentPeriodStart: utcInput(subscription.current_period_start),
              currentPeriodEnd: utcInput(subscription.current_period_end),
            }}
          />
        ) : (
          <p className="text-sm text-slate-500">
            This business has no subscription yet (it gets one when it goes live).
          </p>
        )}
      </section>

      {subscription && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-1 text-sm font-semibold text-slate-900">Usage thresholds (this subscriber only)</h2>
          <p className="mb-3 text-xs text-slate-500">
            {plan?.name.en ?? subscription.plan_key} plan defaults:{" "}
            {planConversationLimit?.toLocaleString(locale) ?? "no limit"} conversations
            {planAiCostLimit !== null ? ` and a $${planAiCostLimit.toFixed(2)} AI cost cap` : ""} per billing period.
            Leave a field empty to use the plan default; Reset to Plan Defaults clears both.
            {usage &&
              ` Now: ${usage.conversationsUsed.toLocaleString(locale)} conversations and $${usage.aiCostUsed.toFixed(4)} AI cost this ${usage.isTrial ? "trial" : "period"}.`}
            {subscription.status === "trialing" &&
              " While trialing, the trial limits (Usage & AI Cost) apply; these take effect once the subscription is paid."}
          </p>
          <SubscriberUsageOverridesForm
            locale={locale}
            tenantId={tenant.id}
            slug={tenant.slug}
            conversationLimitOverride={subscription.conversation_limit_override}
            aiCostLimitOverride={aiOverride ? Number(aiOverride.limit_usd) : null}
            conversationLimitDefault={planConversationLimit}
            aiCostLimitDefault={planAiCostLimit}
          />
        </section>
      )}
    </div>
  );
}
