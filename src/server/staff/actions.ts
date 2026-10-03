"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { consoleOrigin } from "@/lib/hosts";
import { serverEnv } from "@/server/env";
import { createUserClient } from "@/server/supabase/clients";
import { actionT } from "@/server/i18n/action-messages";
import { requireTenantMember, requireUser } from "@/server/tenant/context";

/**
 * Staff invitations (spec §98 Phase 8). There is no email-sending
 * integration yet — the same MVP posture as Phase 6's mock payment
 * provider — so "inviting" someone produces a link the owner/admin copies
 * and sends themselves, rather than the platform emailing it.
 * `create_staff_invite`/`accept_staff_invite` (SQL, SECURITY DEFINER) do
 * all the actual authorization and identity-matching; every action here
 * is a thin wrapper, same as every other console action in this app.
 */

function consoleUrl(path: string): string {
  const env = serverEnv();
  const origin = consoleOrigin({
    rootDomain: env.PLATFORM_ROOT_DOMAIN,
    consoleSubdomain: env.CONSOLE_SUBDOMAIN,
    agentSubdomain: env.AGENT_SUBDOMAIN,
    scheme: env.PUBLIC_URL_SCHEME,
    port: env.PUBLIC_URL_PORT,
    consoleUrl: env.CONSOLE_URL,
  });
  return `${origin}${path}`;
}

const inviteSchema = z.object({
  tenantId: z.uuid(),
  email: z.email(),
  roleKey: z.enum(["business_admin", "staff"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export type InviteStaffState = { inviteLink: string; email: string } | { error: string } | undefined;

export async function inviteStaffAction(_prevState: InviteStaffState, formData: FormData): Promise<InviteStaffState> {
  const parsed = inviteSchema.safeParse({
    tenantId: formData.get("tenantId"),
    email: formData.get("email"),
    roleKey: formData.get("roleKey"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  const t = await actionT(formData.get("locale"));
  if (!parsed.success) return { error: t("staff.invalidInput") };

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  const { data, error } = await supabase.rpc("create_staff_invite", {
    p_tenant_id: parsed.data.tenantId,
    p_email: parsed.data.email,
    p_role_key: parsed.data.roleKey,
  });
  if (error || !data?.[0]) {
    return { error: error?.code === "42501" ? t("staff.noPermission") : error?.message.startsWith("VALIDATION_ERROR") ? t("staff.invalidInput") : t("staff.inviteFailed") };
  }

  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/staff`);
  return { inviteLink: consoleUrl(`/${parsed.data.locale}/invite/${data[0].token}`), email: parsed.data.email };
}

const revokeSchema = z.object({ inviteId: z.uuid(), locale: z.string(), slug: z.string().min(1) });

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const parsed = revokeSchema.safeParse({
    inviteId: formData.get("inviteId"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("revoke_staff_invite", { p_invite_id: parsed.data.inviteId });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/staff`);
}

const roleSchema = z.object({
  memberId: z.uuid(),
  roleKey: z.enum(["business_admin", "staff"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function updateMemberRoleAction(formData: FormData): Promise<void> {
  const parsed = roleSchema.safeParse({
    memberId: formData.get("memberId"),
    roleKey: formData.get("roleKey"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("update_staff_member_role", { p_member_id: parsed.data.memberId, p_role_key: parsed.data.roleKey });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/staff`);
}

const statusSchema = z.object({
  memberId: z.uuid(),
  status: z.enum(["active", "disabled"]),
  locale: z.string(),
  slug: z.string().min(1),
});

export async function setMemberStatusAction(formData: FormData): Promise<void> {
  const parsed = statusSchema.safeParse({
    memberId: formData.get("memberId"),
    status: formData.get("status"),
    locale: formData.get("locale"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return;

  await requireTenantMember(parsed.data.locale, parsed.data.slug);
  const supabase = await createUserClient();
  await supabase.rpc("set_staff_member_status", { p_member_id: parsed.data.memberId, p_status: parsed.data.status });
  revalidatePath(`/${parsed.data.locale}/${parsed.data.slug}/staff`);
}

const acceptSchema = z.object({ token: z.string().min(1), locale: z.string() });

export type AcceptInviteState = string | undefined;

/** The invite-accept page's only action — the signed-in visitor redeems their own token. */
export async function acceptInviteAction(_prevState: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const t = await actionT(formData.get("locale"));
  const parsed = acceptSchema.safeParse({ token: formData.get("token"), locale: formData.get("locale") });
  if (!parsed.success) return t("staff.invalidLink");

  await requireUser(parsed.data.locale);
  const supabase = await createUserClient();
  const { data: tenantId, error } = await supabase.rpc("accept_staff_invite", { p_token: parsed.data.token });
  if (error || !tenantId) {
    const m = error?.message ?? "";
    return m.startsWith("NOT_FOUND") ? t("staff.expired") : m.includes("different email") ? t("staff.otherEmail") : t("staff.acceptFailed");
  }

  const { data: tenant } = await supabase.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  if (!tenant) return t("staff.noBusiness");
  redirect(`/${parsed.data.locale}/${tenant.slug}`);
}
