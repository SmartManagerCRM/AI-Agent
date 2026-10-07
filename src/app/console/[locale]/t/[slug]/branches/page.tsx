import { BranchDeliveryToggle } from "@/components/catalog/branch-delivery-toggle";
import { CreateBranchForm } from "@/components/catalog/create-branch-form";
import { ManageActionButton, ManagedItem } from "@/components/console/managed-item";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";
import { deleteBranchAction, setBranchActiveAction, setDefaultBranchAction, updateBranchAction } from "@/server/manage/actions";
import { Msg } from "@/components/i18n/msg";
import { getTranslations } from "next-intl/server";

export default async function BranchesPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const tAll = await getTranslations();
  const [{ data: branches }, { data: allowanceRaw }] = await Promise.all([
    supabase.from("branches").select("*").eq("tenant_id", tenant.id).order("created_at"),
    supabase.rpc("tenant_branch_allowance", { p_tenant_id: tenant.id }),
  ]);
  // The plan's branch limit (null: none) and the active branches counted against it.
  const allowance = allowanceRaw as { limit: number | null; active: number } | null;
  const limit = allowance?.limit ?? null;
  const full = limit !== null && (allowance?.active ?? 0) >= limit;
  const shown = (text: Record<string, string> | null) => (text ? (text[locale] ?? Object.values(text)[0] ?? "") : "");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold"><Msg id="console.branches.branches" /></h1>
      {limit !== null && (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${full ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-white text-slate-600"}`}
          data-testid="branch-allowance"
        >
          {tAll("console.branches.allowance", { active: allowance?.active ?? 0, limit })}
          {full && <> {tAll("console.branches.allowanceFull")}</>}
        </p>
      )}
      {!full && <CreateBranchForm tenantId={tenant.id} slug={slug} locale={locale} />}
      <ul className="flex flex-col gap-2" data-testid="branch-list">
        {(branches ?? []).map((branch) => {
          const name = shown(branch.name) || tAll("common.untitled");
          const address = shown(branch.address as Record<string, string> | null);
          const hidden = { locale, slug, id: branch.id };
          return (
            <ManagedItem
              key={branch.id}
              testId="branch-row"
              title={name}
              badges={branch.is_default && <span className="ms-2 text-xs font-normal text-neutral-400"><Msg id="console.branches.default" /></span>}
              details={[branch.phone, address].filter(Boolean).join(" · ") || undefined}
              hidden={hidden}
              fields={[
                { name: "name", label: tAll("common.name"), defaultValue: name, required: true, maxLength: 120 },
                { name: "phone", label: tAll("common.phone"), defaultValue: branch.phone, type: "tel", maxLength: 40 },
                { name: "address", label: tAll("console.manage.address"), defaultValue: address, type: "textarea", maxLength: 300 },
              ]}
              update={updateBranchAction}
              active={branch.is_active}
              toggle={branch.is_default ? undefined : setBranchActiveAction}
              remove={branch.is_default ? undefined : deleteBranchAction}
              deleteConfirm={tAll("console.manage.deleteBranch", { name })}
              extra={
                <>
                  <BranchDeliveryToggle hidden={hidden} delivers={branch.offers_delivery} />
                  {!branch.is_default && branch.is_active && (
                    <ManageActionButton action={setDefaultBranchAction} hidden={hidden} icon="check" tone="emerald" label={tAll("console.manage.makeDefault")} />
                  )}
                </>
              }
            />
          );
        })}
        {(branches ?? []).length === 0 && <p className="text-sm text-neutral-400"><Msg id="console.branches.noBranchesYet" /></p>}
      </ul>
    </div>
  );
}
