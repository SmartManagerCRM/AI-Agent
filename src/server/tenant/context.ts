import "server-only";

import { redirect } from "next/navigation";

import { createUserClient } from "@/server/supabase/clients";

export type TenantMembership = {
  tenant_id: string;
  slug: string;
  business_name: Record<string, string>;
  status: string;
  role_key: string;
};

export async function currentUser() {
  const supabase = await createUserClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Redirects to sign-in when there is no session; otherwise returns the user. */
export async function requireUser(locale: string) {
  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

export async function myTenantMemberships(): Promise<TenantMembership[]> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("my_tenant_memberships");
  if (error) throw new Error(`Failed to load tenant memberships: ${error.message}`);
  return data ?? [];
}

/**
 * Loads the tenant for `slug` and confirms the signed-in user is one of its
 * active members, redirecting otherwise. Tenant identity always comes from
 * this server-side check — never from a value the client merely echoes back.
 *
 * A Super Admin who is not a member is admitted anyway if — and only if —
 * they hold a currently active `super_admin_impersonations` grant for this
 * exact tenant (spec's "secure impersonation/tenant-console access for
 * Super Admin"). The grant only ever gets a caller past this app-level
 * check; every read/write it then makes still goes through the same RLS
 * policies as always, which already let a Super Admin through
 * (`app.has_permission`'s own `is_super_admin()` bypass) — this function is
 * the sole gate that was ever missing. `isSuperAdmin` is re-verified here
 * against the real table, never trusted from the grant row alone, so a
 * stale or tampered-with grant for a non-admin user still redirects.
 */
export async function requireTenantMember(locale: string, slug: string) {
  const user = await requireUser(locale);
  const supabase = await createUserClient();
  const { data: tenant, error } = await supabase.from("tenants").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  // RLS already scopes this to tenants the user belongs to (or Super Admin);
  // a null result here means "not found or not a member" — never distinguish
  // the two to an unauthenticated caller.
  if (!tenant) redirect(`/${locale}`);

  const memberships = await myTenantMemberships();
  const membership = memberships.find((m) => m.tenant_id === tenant.id);
  if (membership) return { tenant, membership, impersonating: false as const };

  const { data: grant } = await supabase
    .from("super_admin_impersonations")
    .select("tenant_id")
    .eq("admin_user_id", user.id)
    .is("ended_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (grant?.tenant_id === tenant.id && (await isSuperAdmin(user.id))) {
    return { tenant, membership: null, impersonating: true as const };
  }

  redirect(grant ? `/${locale}/super-admin/businesses/${slug}` : `/${locale}`);
}

export async function requireSuperAdmin(locale: string) {
  const user = await requireUser(locale);
  if (!(await isSuperAdmin(user.id))) redirect(`/${locale}`);
  return user;
}

/**
 * Non-redirecting check — a Super Admin who also owns a business (the
 * common case: the first Super Admin bootstraps into a real tenant, e.g.
 * during onboarding) still lands in their own tenant console by default;
 * this is what lets the tenant nav offer a way into `/super-admin` instead
 * of forcing a choice.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  const supabase = await createUserClient();
  const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`Failed to check Super Admin status: ${error.message}`);
  return data !== null;
}
