import { CreateBusinessTypeForm } from "@/components/platform/business-types-form";
import { PlatformSettingsForm } from "@/components/platform/platform-settings-form";
import { setBusinessTypeActiveAction } from "@/server/platform/business-type-actions";
import { createUserClient, serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

export default async function PlatformSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

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

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">Platform Settings</h1>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Business types</h2>
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
                  {t.is_active ? "Active" : "Inactive"}
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
