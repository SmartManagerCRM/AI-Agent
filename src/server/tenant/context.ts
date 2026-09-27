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
 */
export async function requireTenantMember(locale: string, slug: string) {
  await requireUser(locale);
  const supabase = await createUserClient();
  const { data: tenant, error } = await supabase.from("tenants").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed to load tenant: ${error.message}`);
  // RLS already scopes this to tenants the user belongs to (or Super Admin);
  // a null result here means "not found or not a member" — never distinguish
  // the two to an unauthenticated caller.
  if (!tenant) redirect(`/${locale}`);

  const memberships = await myTenantMemberships();
  const membership = memberships.find((m) => m.tenant_id === tenant.id);
  if (!membership) redirect(`/${locale}`);

  return { tenant, membership };
}

export async function requireSuperAdmin(locale: string) {
  const user = await requireUser(locale);
  const supabase = await createUserClient();
  const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (error) throw new Error(`Failed to check Super Admin status: ${error.message}`);
  if (!data) redirect(`/${locale}`);
  return user;
}
