import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import { rows, timed } from "@/server/perf";
import { createUserClient } from "@/server/supabase/clients";

export type TenantMembership = {
  tenant_id: string;
  slug: string;
  business_name: Record<string, string>;
  status: string;
  role_key: string;
};

/*
 * Every export here is wrapped in React's `cache()`: the tenant layout and
 * the page it wraps both resolve the same user/tenant/memberships during a
 * single render, and without this each call was a separate Supabase round
 * trip (`auth.getUser()` alone ran two to three times per page load).
 * `cache()` is request-scoped — its memo is discarded when the request ends
 * and is never shared across requests — so a result can only ever be
 * reused within the one request (one user's cookies) that produced it.
 * Outside a render (e.g. inside a Server Action) it simply calls through.
 * Every check below still runs exactly as before; only duplicates collapse.
 */

export const currentUser = cache(async () => {
  const supabase = await createUserClient();
  const { data } = await timed("auth.getUser", supabase.auth.getUser());
  return data.user;
});

/** Redirects to sign-in when there is no session; otherwise returns the user. */
export async function requireUser(locale: string) {
  const user = await currentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

export const myTenantMemberships = cache(async (): Promise<TenantMembership[]> => {
  const supabase = await createUserClient();
  const { data, error } = await timed("tenant.memberships", supabase.rpc("my_tenant_memberships"), rows);
  if (error) throw new Error(`Failed to load tenant memberships: ${error.message}`);
  return data ?? [];
});

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
export const requireTenantMember = cache(async (locale: string, slug: string) => {
  const user = await requireUser(locale);
  const supabase = await createUserClient();
  const { data: tenant, error } = await timed(
    "tenant.bySlug",
    supabase.from("tenants").select("*").eq("slug", slug).maybeSingle(),
  );
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  // RLS already scopes this to tenants the user belongs to (or Super Admin);
  // a null result here means "not found or not a member" — never distinguish
  // the two to an unauthenticated caller.
  if (!tenant) redirect(`/${locale}/subscriber`);

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

  redirect(grant ? `/${locale}/super-admin/businesses/${slug}` : `/${locale}/subscriber`);
});

export const requireSuperAdmin = cache(async (locale: string) => {
  const user = await requireUser(locale);
  if (!(await isSuperAdmin(user.id))) redirect(`/${locale}/subscriber`);
  return user;
});

/**
 * Non-redirecting check — a Super Admin who also owns a business (the
 * common case: the first Super Admin bootstraps into a real tenant, e.g.
 * during onboarding) still lands in their own tenant console by default;
 * this is what lets the tenant nav offer a way into `/super-admin` instead
 * of forcing a choice.
 */
export const isSuperAdmin = cache(async (userId: string): Promise<boolean> => {
  const supabase = await createUserClient();
  const { data, error } = await timed(
    "auth.isSuperAdmin",
    supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(),
  );
  if (error) throw new Error(`Failed to check Super Admin status: ${error.message}`);
  return data !== null;
});
