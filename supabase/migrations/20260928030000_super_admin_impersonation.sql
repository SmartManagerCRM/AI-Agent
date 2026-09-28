-- Super Admin Master Spec, Phase 4 — secure impersonation / tenant-console
-- access for Super Admin. RLS already lets a Super Admin read and write
-- every tenant-scoped table gated by `app.has_permission` (it ORs
-- `app.is_super_admin()` — see the subscriptions migration's own
-- `has_permission` definition): the only thing stopping a Super Admin
-- from opening a business's own console today is the app-level
-- `requireTenantMember` check, which requires a real `tenant_members` row.
-- This migration adds the explicit, time-boxed, audited grant that lets
-- `requireTenantMember` admit a Super Admin without ever weakening the
-- underlying RLS, exactly like the spec's "explicit server-side role-
-- gated, never CSS/client-only" requirement.
--
-- One active grant per admin at a time (starting a new one ends the old),
-- expires after one hour, and every start/end is written to `audit_logs`
-- — the same "written only by a SECURITY DEFINER function, never a
-- client insert" discipline the audit log itself already documents.
create table public.super_admin_impersonations (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);
create unique index super_admin_impersonations_one_active_uidx
  on public.super_admin_impersonations (admin_user_id) where ended_at is null;
create index super_admin_impersonations_tenant_idx on public.super_admin_impersonations (tenant_id);

alter table public.super_admin_impersonations enable row level security;
alter table public.super_admin_impersonations force row level security;
create policy super_admin_impersonations_select on public.super_admin_impersonations
  for select using (admin_user_id = auth.uid());
-- No insert/update/delete policy — only the two functions below may write
-- this table.

create or replace function public.start_tenant_impersonation(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
begin
  if not app.is_super_admin() then
    raise exception 'SUPER_ADMIN_REQUIRED: only a Super Admin can impersonate a business.';
  end if;
  if not exists (select 1 from public.tenants where id = p_tenant_id) then
    raise exception 'NOT_FOUND: no such business.';
  end if;

  update public.super_admin_impersonations
    set ended_at = now()
    where admin_user_id = v_admin and ended_at is null;

  insert into public.super_admin_impersonations (admin_user_id, tenant_id, expires_at)
  values (v_admin, p_tenant_id, now() + interval '1 hour');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, v_admin, 'super_admin.impersonation_started', 'tenant', p_tenant_id);
end;
$$;
revoke all on function public.start_tenant_impersonation(uuid) from public;
grant execute on function public.start_tenant_impersonation(uuid) to authenticated;

create or replace function public.end_tenant_impersonation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_tenant uuid;
begin
  update public.super_admin_impersonations
    set ended_at = now()
    where admin_user_id = v_admin and ended_at is null
    returning tenant_id into v_tenant;

  if v_tenant is not null then
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
    values (v_tenant, v_admin, 'super_admin.impersonation_ended', 'tenant', v_tenant);
  end if;
end;
$$;
revoke all on function public.end_tenant_impersonation() from public;
grant execute on function public.end_tenant_impersonation() to authenticated;
