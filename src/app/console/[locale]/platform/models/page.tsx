import { CreateModelConfigForm } from "@/components/platform/create-model-config-form";
import { setAiModelConfigFieldAction } from "@/server/platform/actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

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
  const supabase = await createUserClient();

  const { data: configs } = await supabase
    .from("ai_model_configs")
    .select("id, provider, model, kind, input_price_per_million_usd, output_price_per_million_usd, is_active, is_default")
    .order("kind")
    .order("created_at");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">AI model routing</h1>

      <CreateModelConfigForm locale={locale} />

      <table className="w-full text-start text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-neutral-500">
            <th className="py-2 text-start">Kind</th>
            <th className="py-2 text-start">Provider</th>
            <th className="py-2 text-start">Model</th>
            <th className="py-2 text-start">Input $/M</th>
            <th className="py-2 text-start">Output $/M</th>
            <th className="py-2 text-start">Active</th>
            <th className="py-2 text-start">Default</th>
          </tr>
        </thead>
        <tbody>
          {(configs ?? []).map((config) => (
            <tr key={config.id} className="border-b border-neutral-100">
              <td className="py-2 capitalize">{config.kind}</td>
              <td className="py-2 capitalize">{config.provider}</td>
              <td className="py-2 font-mono text-xs">{config.model}</td>
              <td className="py-2">{config.input_price_per_million_usd}</td>
              <td className="py-2">{config.output_price_per_million_usd}</td>
              <td className="py-2">
                <form action={setAiModelConfigFieldAction}>
                  <input type="hidden" name="configId" value={config.id} />
                  <input type="hidden" name="field" value="is_active" />
                  <input type="hidden" name="value" value={(!config.is_active).toString()} />
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" className="text-xs text-blue-700 underline">
                    {config.is_active ? "On" : "Off"}
                  </button>
                </form>
              </td>
              <td className="py-2">
                <form action={setAiModelConfigFieldAction}>
                  <input type="hidden" name="configId" value={config.id} />
                  <input type="hidden" name="field" value="is_default" />
                  <input type="hidden" name="value" value="true" />
                  <input type="hidden" name="locale" value={locale} />
                  <button type="submit" disabled={config.is_default} className="text-xs text-blue-700 underline disabled:no-underline disabled:text-neutral-400">
                    {config.is_default ? "Default" : "Make default"}
                  </button>
                </form>
              </td>
            </tr>
          ))}
          {(configs ?? []).length === 0 && (
            <tr>
              <td colSpan={7} className="py-4 text-center text-neutral-400">
                No models configured yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
