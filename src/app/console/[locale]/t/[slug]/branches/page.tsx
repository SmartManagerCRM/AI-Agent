import { CreateBranchForm } from "@/components/catalog/create-branch-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";

export default async function BranchesPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const tAll = await getTranslations();
  const { data: branches } = await supabase.from("branches").select("*").eq("tenant_id", tenant.id).order("created_at");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold"><Msg id="console.branches.branches" /></h1>
      <CreateBranchForm tenantId={tenant.id} slug={slug} locale={locale} />
      <ul className="flex flex-col gap-2">
        {(branches ?? []).map((branch) => (
          <li key={branch.id} className="rounded-md border border-neutral-200 px-4 py-3 text-sm">
            <p className="font-medium">
              {branch.name[locale] ?? Object.values(branch.name)[0] ?? tAll("common.untitled")}
              {branch.is_default && <span className="ms-2 text-xs text-neutral-400"><Msg id="console.branches.default" /></span>}
            </p>
            {branch.phone && <p className="text-neutral-500">{branch.phone}</p>}
          </li>
        ))}
        {(branches ?? []).length === 0 && <p className="text-sm text-neutral-400"><Msg id="console.branches.noBranchesYet" /></p>}
      </ul>
    </div>
  );
}
