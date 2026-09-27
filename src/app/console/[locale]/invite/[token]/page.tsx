import { createHash } from "node:crypto";

import { AcceptInviteForm } from "@/components/staff/accept-invite-form";
import { CredentialsForm } from "@/components/auth/credentials-form";
import { signInAction, signUpAction } from "@/server/auth/actions";
import { serviceClient } from "@/server/supabase/clients";
import { currentUser } from "@/server/tenant/context";

export const dynamic = "force-dynamic";

/**
 * Invite acceptance (spec §98 Phase 8). The invite row itself is looked up
 * here with the service-role client purely to *display* who it's for —
 * the invitee has no `staff.read` on this tenant yet (they are not a
 * member), so RLS would otherwise hide it from them entirely. This lookup
 * grants nothing: `accept_staff_invite` (SQL) re-validates the token,
 * expiry and email match itself before creating any membership.
 */
export default async function InviteAcceptPage({ params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const supabase = serviceClient();
  const { data: invite } = await supabase
    .from("staff_invites")
    .select("email, role_key, status, expires_at, tenant_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  const isValid = invite && invite.status === "pending" && new Date(invite.expires_at) > new Date();
  if (!invite || !isValid) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-2 px-6 text-center">
        <h1 className="text-xl font-semibold">Invite not available</h1>
        <p className="text-sm text-neutral-500">This invite link is invalid, has already been used, or has expired.</p>
      </main>
    );
  }

  const { data: tenant } = await supabase.from("tenants").select("business_name").eq("id", invite.tenant_id).maybeSingle();
  const businessName = tenant ? (tenant.business_name[locale] ?? Object.values(tenant.business_name)[0]) : "this business";
  const user = await currentUser();
  const redirectTo = `/${locale}/invite/${token}`;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-xl font-semibold">You&apos;re invited to join {businessName}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          as <span className="capitalize">{invite.role_key.replace("_", " ")}</span> ({invite.email})
        </p>
      </div>

      {user ? (
        <AcceptInviteForm token={token} locale={locale} />
      ) : (
        <div className="flex w-full flex-col gap-4">
          <p className="text-sm text-neutral-500">Sign in or create an account with {invite.email} to accept.</p>
          <CredentialsForm
            action={signInAction}
            locale={locale}
            redirectTo={redirectTo}
            emailLabel="Email"
            passwordLabel="Password"
            submitLabel="Sign in & accept"
          />
          <CredentialsForm
            action={signUpAction}
            locale={locale}
            redirectTo={redirectTo}
            emailLabel="Email"
            passwordLabel="Password"
            submitLabel="Create account & accept"
          />
        </div>
      )}
    </main>
  );
}
