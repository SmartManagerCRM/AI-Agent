-- Phase 9 — Super Admin (spec §98). Most of this phase's surface needed
-- no new SQL at all: `app.has_permission`'s own `is_super_admin()` bypass
-- already lets a Super Admin update any tenant row (`tenants_update`,
-- Phase 1) and read every tenant's `agent_interactions`
-- (`agent_interactions_select`, Phase 3), and `ai_model_configs` has
-- carried a Super-Admin-only write policy since Phase 3 with the comment
-- "Phase 9 adds the UI; the gate exists from the start." This migration
-- only adds what was genuinely missing: a write path for
-- `platform_settings`, and the two functions managing `platform_admins`
-- needs — looking a user up by email, which `auth.users` does not expose
-- to any regular signed-in session, Super Admin included.

create policy platform_settings_update on public.platform_settings
  for update using (app.is_super_admin()) with check (app.is_super_admin());

create or replace function public.add_platform_admin(p_email citext, p_level text default 'admin')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: Super Admin required' using errcode = '42501';
  end if;
  if p_level not in ('admin', 'owner') then
    raise exception 'VALIDATION_ERROR: unknown level %', p_level;
  end if;

  select id into v_user_id from auth.users where email = p_email;
  if v_user_id is null then
    raise exception 'NOT_FOUND: no account exists for %', p_email;
  end if;

  insert into public.platform_admins (user_id, level) values (v_user_id, p_level)
  on conflict (user_id) do update set level = excluded.level;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (null, auth.uid(), 'platform_admin.added', 'platform_admin', v_user_id);
end;
$$;
revoke all on function public.add_platform_admin(citext, text) from public;
grant execute on function public.add_platform_admin(citext, text) to authenticated;

-- Never lets the platform end up with zero Super Admins, the same
-- "refuse, don't just discourage" posture as Phase 8's owner guards.
create or replace function public.remove_platform_admin(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: Super Admin required' using errcode = '42501';
  end if;
  if (select count(*) from public.platform_admins) <= 1 then
    raise exception 'VALIDATION_ERROR: cannot remove the last Super Admin';
  end if;

  delete from public.platform_admins where user_id = p_user_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (null, auth.uid(), 'platform_admin.removed', 'platform_admin', p_user_id);
end;
$$;
revoke all on function public.remove_platform_admin(uuid) from public;
grant execute on function public.remove_platform_admin(uuid) to authenticated;
