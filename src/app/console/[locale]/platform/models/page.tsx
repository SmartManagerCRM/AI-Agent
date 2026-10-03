import { CreateModelConfigForm } from "@/components/platform/create-model-config-form";
import { setAiModelConfigFieldAction } from "@/server/platform/actions";
import { serviceClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";
import { getTranslations } from "next-intl/server";

/**
 * AI model routing config (spec §6, §98 Phase 9): "never hard-code a
 * model name" — `src/server/ai/router.ts` reads `ai_model_configs` and
 * nothing else. The write gate (`ai_model_configs_write`, Super-Admin-
 * only) has existed since Phase 3 with the comment "Phase 9 adds the
 * UI" — this page is that UI. No new migration was needed: it's a plain
 * RLS-scoped read/write, same as the tenant console's own settings pages.
 */
export default async function ModelConfigsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const t = await getTranslations("platform.models");
  // Token prices are hidden from signed-in users (column grants) — Super Admin checked above.
  const { data: configs } = await serviceClient()
    .from("ai_model_configs")
    .select(
      "id, provider, model, kind, input_price_per_million_usd, output_price_per_million_usd, is_active, is_default",
    )
    .order("kind")
    .order("created_at");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold text-slate-900">{t("title")}</h1>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("add")}</h2>
        <CreateModelConfigForm locale={locale} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t("pricing")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2 text-start font-medium">{t("col.kind")}</th>
                <th className="py-2 text-start font-medium">{t("col.provider")}</th>
                <th className="py-2 text-start font-medium">{t("col.model")}</th>
                <th className="py-2 text-start font-medium">{t("col.input")}</th>
                <th className="py-2 text-start font-medium">{t("col.output")}</th>
                <th className="py-2 text-start font-medium">{t("col.active")}</th>
                <th className="py-2 text-start font-medium">{t("col.default")}</th>
              </tr>
            </thead>
            <tbody>
              {(configs ?? []).map((config) => (
                <tr key={config.id} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 text-slate-700">{t.has(`kind.${config.kind}`) ? t(`kind.${config.kind}`) : config.kind}</td>
                  <td className="py-2 capitalize text-slate-700">{config.provider}</td>
                  <td className="py-2 font-mono text-xs text-slate-600">{config.model}</td>
                  <td className="py-2 text-slate-600">{config.input_price_per_million_usd}</td>
                  <td className="py-2 text-slate-600">{config.output_price_per_million_usd}</td>
                  <td className="py-2">
                    <form action={setAiModelConfigFieldAction}>
                      <input type="hidden" name="configId" value={config.id} />
                      <input type="hidden" name="field" value="is_active" />
                      <input type="hidden" name="value" value={(!config.is_active).toString()} />
                      <input type="hidden" name="locale" value={locale} />
                      <button type="submit" className="text-xs font-medium text-emerald-600 hover:underline">
                        {config.is_active ? t("on") : t("off")}
                      </button>
                    </form>
                  </td>
                  <td className="py-2">
                    <form action={setAiModelConfigFieldAction}>
                      <input type="hidden" name="configId" value={config.id} />
                      <input type="hidden" name="field" value="is_default" />
                      <input type="hidden" name="value" value="true" />
                      <input type="hidden" name="locale" value={locale} />
                      <button
                        type="submit"
                        disabled={config.is_default}
                        className="text-xs font-medium text-emerald-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                      >
                        {config.is_default ? t("isDefault") : t("makeDefault")}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
              {(configs ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-slate-400">
                    {t("none")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
