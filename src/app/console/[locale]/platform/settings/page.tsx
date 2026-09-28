import { PlatformSettingsForm } from "@/components/platform/platform-settings-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

export default async function PlatformSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const { data: settings } = await supabase
    .from("platform_settings")
    .select("platform_name, maintenance_mode")
    .eq("id", true)
    .maybeSingle();

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold text-slate-900">Platform Settings</h1>
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <PlatformSettingsForm
          locale={locale}
          current={settings ?? { platform_name: "SmartManager AI Agent", maintenance_mode: false }}
        />
      </section>
    </div>
  );
}
