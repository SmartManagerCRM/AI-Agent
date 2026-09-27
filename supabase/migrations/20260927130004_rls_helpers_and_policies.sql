-- Phase 1 — Foundation. RLS predicate helpers (spec §21) and policies.
--
-- Helpers are SECURITY DEFINER / STABLE with a pinned empty search_path (every
-- reference is schema-qualified) so they cannot be hijacked by a search_path
-- change, and — because they are owned by the migration role, which carries
-- BYPASSRLS on Supabase — their own internal reads are not blocked by the RLS
-- they are busy evaluating.

create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid());
$$;

create or replace function app.is_tenant_member(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function app.has_permission(p_tenant_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    app.is_super_admin()
    or exists (
      select 1
      from public.tenant_members tm
      join public.role_permissions rp on rp.role_id = tm.role_id
      where tm.tenant_id = p_tenant_id
        and tm.user_id = auth.uid()
        and tm.status = 'active'
        and rp.permission_key = p_permission
    );
$$;

-- ── platform_settings: readable by anyone signed in (drives UI copy/limits
--    that are not secret); writable only by Super Admin, via app code that
--    still re-checks — no RLS write policy is granted directly.
alter table public.platform_settings enable row level security;
alter table public.platform_settings force row level security;
create policy platform_settings_select on public.platform_settings
  for select to authenticated using (true);

-- ── currencies / business_types: public reference data.
alter table public.currencies enable row level security;
alter table public.currencies force row level security;
create policy currencies_select on public.currencies for select to authenticated, anon using (true);

alter table public.business_types enable row level security;
alter table public.business_types force row level security;
create policy business_types_select on public.business_types for select to authenticated, anon using (true);

-- ── tenants
alter table public.tenants enable row level security;
alter table public.tenants force row level security;
create policy tenants_select on public.tenants
  for select using (app.is_tenant_member(id) or app.is_super_admin());
create policy tenants_update on public.tenants
  for update using (app.has_permission(id, 'settings.write'))
  with check (app.has_permission(id, 'settings.write'));
-- No insert/delete policy: tenants are created only through create_business()
-- (SECURITY DEFINER) and deleted only via a future platform operation.

-- ── tenant_settings
alter table public.tenant_settings enable row level security;
alter table public.tenant_settings force row level security;
create policy tenant_settings_select on public.tenant_settings
  for select using (app.is_tenant_member(tenant_id) or app.is_super_admin());
create policy tenant_settings_update on public.tenant_settings
  for update using (app.has_permission(tenant_id, 'settings.write'))
  with check (app.has_permission(tenant_id, 'settings.write'));

-- ── profiles: a user manages their own; Super Admin can read all.
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or app.is_super_admin());
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ── platform_admins: only visible to other admins; no client write policy.
alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
create policy platform_admins_select on public.platform_admins
  for select using (app.is_super_admin());

-- ── roles / permissions / role_permissions: readable by any signed-in user
--    (role/permission names are not sensitive); no client write policy —
--    system roles are seed data, tenant custom roles are a later phase.
alter table public.roles enable row level security;
alter table public.roles force row level security;
create policy roles_select on public.roles for select to authenticated using (true);

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
create policy permissions_select on public.permissions for select to authenticated using (true);

alter table public.role_permissions enable row level security;
alter table public.role_permissions force row level security;
create policy role_permissions_select on public.role_permissions for select to authenticated using (true);

-- ── tenant_members: a member sees their own row and fellow members; write
--    is a later phase (staff invitations) — Phase 1 only seeds the owner
--    through create_business().
alter table public.tenant_members enable row level security;
alter table public.tenant_members force row level security;
create policy tenant_members_select on public.tenant_members
  for select using (user_id = auth.uid() or app.is_tenant_member(tenant_id) or app.is_super_admin());

-- ── audit_logs: RLS was enabled (forced) when the table was created; the
--    policy is added here, now that the helpers above exist.
create policy audit_logs_select on public.audit_logs
  for select using (
    app.is_super_admin()
    or (tenant_id is not null and app.has_permission(tenant_id, 'audit.read'))
  );

-- ── Onboarding entry point (spec §72): creates the tenant, its settings row
--    and the caller's owner membership in one transaction. SECURITY DEFINER
--    because a brand-new tenant has no members yet for the normal RLS checks
--    to authorize against.
create or replace function public.create_business(
  p_business_name jsonb,
  p_business_type_key text,
  p_slug text,
  p_default_language text,
  p_currency char(3)
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant_id uuid;
  v_owner_role_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency)
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;

revoke all on function public.create_business(jsonb, text, text, text, char(3)) from public;
grant execute on function public.create_business(jsonb, text, text, text, char(3)) to authenticated;

-- ── Read helper: which tenants does the signed-in user belong to (spec §72
--    "create account → create business"; the console needs this to route a
--    returning owner straight to their business without another form).
create or replace function public.my_tenant_memberships()
returns table (tenant_id uuid, slug citext, business_name jsonb, status text, role_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.slug, t.business_name, t.status, r.key
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  join public.roles r on r.id = tm.role_id
  where tm.user_id = auth.uid() and tm.status = 'active'
  order by tm.created_at;
$$;

revoke all on function public.my_tenant_memberships() from public;
grant execute on function public.my_tenant_memberships() to authenticated;
