import { toggleRolePermissionAction } from "@/server/platform/rbac-actions";
import { createUserClient } from "@/server/supabase/clients";
import { requireSuperAdmin } from "@/server/tenant/context";

/**
 * Super Admin Master Spec, Phase 5 — granular per-permission RBAC. Shows
 * every real, code-enforced permission (each one already gates a real
 * `app.has_permission(tenant_id, '...')` RLS check somewhere in the
 * schema) grouped by module, and which of the 3 system roles currently
 * grants it — the first time this mapping has ever been visible in the
 * UI, not just the database. Toggling a cell is a real, platform-wide
 * policy change (system roles have no tenant_id — see rbac-actions.ts).
 */
export default async function RolesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  await requireSuperAdmin(locale);
  const supabase = await createUserClient();

  const [{ data: roles }, { data: permissions }, { data: grants }] = await Promise.all([
    supabase.from("roles").select("id, key, name").is("tenant_id", null).order("key"),
    supabase.from("permissions").select("key, module, description").order("module").order("key"),
    supabase.from("role_permissions").select("role_id, permission_key"),
  ]);

  const allRoles = roles ?? [];
  const allPermissions = permissions ?? [];
  const grantSet = new Set((grants ?? []).map((g) => `${g.role_id}:${g.permission_key}`));

  const modules = [...new Set(allPermissions.map((p) => p.module))];
  const ROLE_ORDER = ["business_owner", "business_admin", "staff"];
  const orderedRoles = [...allRoles].sort((a, b) => ROLE_ORDER.indexOf(a.key) - ROLE_ORDER.indexOf(b.key));

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Roles &amp; Permissions</h1>
        <p className="mt-1 text-sm text-slate-500">
          What each system role can do, across every business on the platform. These 3 roles are shared by every tenant
          — toggling a permission here changes it everywhere at once, not just for one business.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {orderedRoles.map((role) => (
          <section key={role.id} className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">{role.name[locale] ?? role.name.en ?? role.key}</h2>
            <p className="mb-3 font-mono text-xs text-slate-400">{role.key}</p>
            <div className="flex flex-col gap-3">
              {modules.map((mod) => (
                <div key={mod}>
                  <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{mod}</p>
                  <div className="flex flex-col gap-1">
                    {allPermissions
                      .filter((p) => p.module === mod)
                      .map((permission) => {
                        const granted = grantSet.has(`${role.id}:${permission.key}`);
                        return (
                          <form
                            key={permission.key}
                            action={toggleRolePermissionAction}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <input type="hidden" name="roleId" value={role.id} />
                            <input type="hidden" name="permissionKey" value={permission.key} />
                            <input type="hidden" name="grant" value={(!granted).toString()} />
                            <input type="hidden" name="locale" value={locale} />
                            <span className="text-slate-600" title={permission.description ?? undefined}>
                              {permission.key}
                            </span>
                            <button
                              type="submit"
                              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                granted
                                  ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                                  : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                              }`}
                            >
                              {granted ? "On" : "Off"}
                            </button>
                          </form>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
