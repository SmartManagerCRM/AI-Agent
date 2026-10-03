import { CreateBusinessTypeForm } from "@/components/platform/business-types-form";
import { PlatformSettingsForm } from "@/components/platform/platform-settings-form";
import { TranslateMissingForm } from "@/components/platform/translate-missing-form";
import { setBusinessTypeActiveAction } from "@/server/platform/business-type-actions";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { translationStatus } from "@/server/translate/status";
import { getTranslations } from "next-intl/server";

export default async function PlatformSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();
  const tr = await getTranslations("platform.settings");
  const tt = await getTranslations("platform.translation");
  const nf = new Intl.NumberFormat(locale);

  const [{ data: settings }, { data: businessTypes }] = await Promise.all([
    // The AI budget column is hidden from signed-in users (column grants); Super Admin checked above.
    serviceClient()
      .from("platform_settings")
      .select(
        "platform_name, maintenance_mode, default_ai_monthly_budget_usd, supported_languages, supported_currencies",
      )
      .eq("id", true)
      .maybeSingle(),
    supabase.from("business_types").select("key, name, is_active").order("key"),
  ]);
  const translation = await translationStatus();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{tr("title")}</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <PlatformSettingsForm
          locale={locale}
          current={
            settings ?? {
              platform_name: "SmartManager AI Agent",
              maintenance_mode: false,
              default_ai_monthly_budget_usd: null,
              supported_languages: ["en", "ar", "fr"],
              supported_currencies: ["SAR", "USD", "EUR"],
            }
          }
        />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4" data-testid="translation-status">
        <h2 className="text-sm font-semibold text-slate-900">{tt("title")}</h2>
        <p className="mt-1 text-sm text-slate-500">{tt("intro")}</p>
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-400">{tt("order")}</p>
        <ol className="mt-2 flex flex-col gap-1.5 text-sm">
          {translation.providers.map((p, i) => (
            <li key={p.provider} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-slate-100 px-3 py-2">
              <span className="text-slate-900">
                {i + 1}. {tt(`provider.${p.provider}`)}
              </span>
              <span className={`text-xs ${!p.configured ? "text-slate-400" : p.exhausted ? "text-amber-700" : "text-emerald-700"}`}>
                {p.provider === "glossary"
                  ? tt("always")
                  : !p.configured
                    ? tt("notSet")
                    : p.exhausted
                      ? tt("usedUp")
                      : p.limit !== null
                        ? tt("usedOf", { used: nf.format(p.used ?? 0), limit: nf.format(p.limit) })
                        : p.provider === "local" && !p.used
                          ? tt("ready")
                          : tt("usedNoCap", { used: nf.format(p.used ?? 0) })}
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-sm text-slate-600">
          {tt("waiting", { n: translation.waiting })} {tt("translated", { n: translation.translated })}
        </p>
        <div className="mt-3">
          <TranslateMissingForm locale={locale} />
        </div>
        <p className="mt-3 text-xs text-slate-400">{tt("keysHint")}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{tr("types")}</h2>
        <div className="mb-4">
          <CreateBusinessTypeForm locale={locale} />
        </div>
        <div className="flex flex-col gap-2">
          {(businessTypes ?? []).map((t) => (
            <div
              key={t.key}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-100 p-2 text-sm"
            >
              <span className="text-slate-900">
                {t.name[locale] ?? t.name.en ?? t.key}{" "}
                <span className="font-mono text-xs text-slate-400">({t.key})</span>
              </span>
              <form action={setBusinessTypeActiveAction}>
                <input type="hidden" name="key" value={t.key} />
                <input type="hidden" name="value" value={(!t.is_active).toString()} />
                <input type="hidden" name="locale" value={locale} />
                <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                  {t.is_active ? tr("active") : tr("inactive")}
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
