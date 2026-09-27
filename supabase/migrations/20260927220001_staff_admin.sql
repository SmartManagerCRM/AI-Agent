-- Phase 8 — Subscriber Admin (spec §98): staff invitations/roles and the
-- profile fields a fellow team member needs to see them by. The
-- staff.read/staff.write/audit.read permissions and their role grants have
-- existed since Phase 1 — nothing before this phase ever built a UI or a
-- write path for them.
--
-- There is no email-sending integration yet (same MVP posture as payments'
-- mock provider): "inviting" someone generates a link the owner/admin
-- copies and sends themselves, rather than the platform emailing it.

-- ── profiles.email: auth.users is not exposed via PostgREST/RLS to a
--    regular signed-in user, so there is no way to show a fellow staff
--    member's email without denormalizing it onto the one profile table
--    that already is exposed. Populated by the same trigger that already
--    creates a profile row on signup, backfilled for existing users. ────
alter table public.profiles add column email citext;

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, preferred_language, email)
  values (new.id, new.raw_user_meta_data ->> 'full_name', coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en'), new.email)
  on conflict (id) do update set email = excluded.email;
  return new;
end;
$$;

update public.profiles p set email = u.email
from auth.users u
where u.id = p.id and p.email is null;

-- A fellow active member of any shared tenant may see this profile's
-- name/email (a staff directory needs this); a user always sees their own,
-- and Super Admin sees all — the same three clauses as before, plus one.
alter policy profiles_select on public.profiles
  using (
    id = auth.uid()
    or app.is_super_admin()
    or exists (
      select 1 from public.tenant_members tm1
      join public.tenant_members tm2 on tm2.tenant_id = tm1.tenant_id
      where tm1.user_id = auth.uid() and tm1.status = 'active'
        and tm2.user_id = profiles.id and tm2.status = 'active'
    )
  );

-- ── staff_invites: a pending offer to join a tenant at a given role. ────
create table public.staff_invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email citext not null,
  role_key text not null check (role_key in ('business_admin', 'staff')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid references auth.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index staff_invites_tenant_idx on public.staff_invites (tenant_id, status);

alter table public.staff_invites enable row level security;
alter table public.staff_invites force row level security;
create policy staff_invites_select on public.staff_invites
  for select using (app.has_permission(tenant_id, 'staff.read') or app.is_super_admin());
-- No insert/update/delete policy — every write is one of the functions below.

-- ── create_staff_invite: staff.write only. Never offers the owner role —
--    ownership is not transferable through this flow. ──────────────────
create or replace function public.create_staff_invite(p_tenant_id uuid, p_email citext, p_role_key text)
returns table (invite_id uuid, token text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_invite_id uuid;
begin
  if not (app.has_permission(p_tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;
  if p_role_key not in ('business_admin', 'staff') then
    raise exception 'VALIDATION_ERROR: cannot invite someone as %', p_role_key;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.staff_invites (tenant_id, email, role_key, token_hash, invited_by, expires_at)
  values (p_tenant_id, p_email, p_role_key, encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid(), now() + interval '7 days')
  returning id into v_invite_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, auth.uid(), 'staff.invited', 'staff_invite', v_invite_id);

  return query select v_invite_id, v_token;
end;
$$;
revoke all on function public.create_staff_invite(uuid, citext, text) from public;
grant execute on function public.create_staff_invite(uuid, citext, text) to authenticated;

-- ── accept_staff_invite: the invited person, now signed in, redeems their
--    own token. Requires the signed-in email to match the invite's —
--    a leaked link cannot be redeemed by anyone else. ──────────────────
create or replace function public.accept_staff_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.staff_invites%rowtype;
  v_user_email extensions.citext;
  v_role_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select * into v_invite from public.staff_invites
    where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and status = 'pending' and expires_at > now();
  if not found then
    raise exception 'NOT_FOUND: this invite is invalid or has expired';
  end if;

  select email into v_user_email from auth.users where id = auth.uid();
  if v_user_email is distinct from v_invite.email then
    raise exception 'VALIDATION_ERROR: this invite was sent to a different email address';
  end if;

  select id into v_role_id from public.roles where tenant_id is null and key = v_invite.role_key;
  if v_role_id is null then
    raise exception 'CONFIG_ERROR: system role % is not seeded', v_invite.role_key;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_invite.tenant_id, auth.uid(), v_role_id, 'active')
  on conflict (tenant_id, user_id) do update set role_id = excluded.role_id, status = 'active';

  update public.staff_invites set status = 'accepted', accepted_at = now() where id = v_invite.id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_invite.tenant_id, auth.uid(), 'staff.invite_accepted', 'staff_invite', v_invite.id);

  return v_invite.tenant_id;
end;
$$;
revoke all on function public.accept_staff_invite(text) from public;
grant execute on function public.accept_staff_invite(text) to authenticated;

-- ── revoke_staff_invite: staff.write only, pending invites only. ───────
create or replace function public.revoke_staff_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.staff_invites%rowtype;
begin
  select * into v_invite from public.staff_invites where id = p_invite_id;
  if not found then
    raise exception 'NOT_FOUND: invite does not exist';
  end if;
  if not (app.has_permission(v_invite.tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;

  update public.staff_invites set status = 'revoked' where id = p_invite_id and status = 'pending';
end;
$$;
revoke all on function public.revoke_staff_invite(uuid) from public;
grant execute on function public.revoke_staff_invite(uuid) to authenticated;

-- ── update_staff_member_role / set_staff_member_status: staff.write only.
--    Neither ever touches a business_owner row — ownership changes and
--    removing the last owner are both refused, not just discouraged. ───
create or replace function public.update_staff_member_role(p_member_id uuid, p_role_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_current_role_key text;
  v_new_role_id uuid;
begin
  select * into v_member from public.tenant_members where id = p_member_id;
  if not found then
    raise exception 'NOT_FOUND: staff member does not exist';
  end if;
  if not (app.has_permission(v_member.tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;
  if p_role_key not in ('business_admin', 'staff') then
    raise exception 'VALIDATION_ERROR: cannot change role to %', p_role_key;
  end if;

  select key into v_current_role_key from public.roles where id = v_member.role_id;
  if v_current_role_key = 'business_owner' then
    raise exception 'VALIDATION_ERROR: the business owner''s role cannot be changed here';
  end if;

  select id into v_new_role_id from public.roles where tenant_id is null and key = p_role_key;
  update public.tenant_members set role_id = v_new_role_id where id = p_member_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_member.tenant_id, auth.uid(), 'staff.role_changed', 'tenant_member', p_member_id,
    jsonb_build_object('from', v_current_role_key, 'to', p_role_key));
end;
$$;
revoke all on function public.update_staff_member_role(uuid, text) from public;
grant execute on function public.update_staff_member_role(uuid, text) to authenticated;

create or replace function public.set_staff_member_status(p_member_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.tenant_members%rowtype;
  v_role_key text;
begin
  if p_status not in ('active', 'disabled') then
    raise exception 'VALIDATION_ERROR: unknown status %', p_status;
  end if;

  select * into v_member from public.tenant_members where id = p_member_id;
  if not found then
    raise exception 'NOT_FOUND: staff member does not exist';
  end if;
  if not (app.has_permission(v_member.tenant_id, 'staff.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: staff.write required' using errcode = '42501';
  end if;

  select key into v_role_key from public.roles where id = v_member.role_id;
  if v_role_key = 'business_owner' and p_status = 'disabled' then
    raise exception 'VALIDATION_ERROR: the business owner cannot be disabled';
  end if;

  update public.tenant_members set status = p_status where id = p_member_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_member.tenant_id, auth.uid(), 'staff.status_changed', 'tenant_member', p_member_id, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.set_staff_member_status(uuid, text) from public;
grant execute on function public.set_staff_member_status(uuid, text) to authenticated;
