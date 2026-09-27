import { CreateBranchForm } from "@/components/catalog/create-branch-form";
import { createUserClient } from "@/server/supabase/clients";
import { requireTenantMember } from "@/server/tenant/context";

export default async function BranchesPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const { tenant } = await requireTenantMember(locale, slug);
  const supabase = await createUserClient();
  const { data: branches } = await supabase.from("branches").select("*").order("created_at");

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Branches</h1>
      <CreateBranchForm tenantId={tenant.id} slug={slug} locale={locale} />
      <ul className="flex flex-col gap-2">
        {(branches ?? []).map((branch) => (
          <li key={branch.id} className="rounded-md border border-neutral-200 px-4 py-3 text-sm">
            <p className="font-medium">
              {branch.name[locale] ?? Object.values(branch.name)[0] ?? "Untitled"}
              {branch.is_default && <span className="ms-2 text-xs text-neutral-400">(default)</span>}
            </p>
            {branch.phone && <p className="text-neutral-500">{branch.phone}</p>}
          </li>
        ))}
        {(branches ?? []).length === 0 && <p className="text-sm text-neutral-400">No branches yet.</p>}
      </ul>
    </div>
  );
}
