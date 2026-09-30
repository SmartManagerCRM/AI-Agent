-- Business Brain → Go live → public Agent lifecycle.
--
-- 1. Regression fix: when 20260928000001_real_payment_providers redefined
--    `create_business`, two things from 20260927210001_subscriptions were
--    dropped: the free-trial subscription insert, and creating the tenant
--    as `active` (it fell back to the column default, `onboarding`).
--    Without either, the public Agent can never resolve the business. Both
--    are restored.
-- 2. `agent_deployments`: the Agent's deployment state per business (one
--    row per existing tenant — never a copy of the business). Readiness is
--    how complete the Business Brain is; deployment is whether the public
--    Agent has actually been published. Only PUBLISHED is publicly
--    reachable.
-- 3. `publish_agent` / `pause_agent`: the only writers, re-checking
--    `agent.write` and the minimum launch requirements server-side.

-- ── 1. create_business: restore the trial subscription ───────────────────
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
  v_default_plan public.subscription_plans%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  select * into v_default_plan from public.subscription_plans where is_default and is_active limit 1;
  if not found then
    raise exception 'CONFIG_ERROR: no default subscription plan is seeded';
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency, status)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency, 'active')
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);
  insert into public.tenant_payment_config (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
  values (v_tenant_id, v_default_plan.key, 'trialing', now() + make_interval(days => v_default_plan.trial_days));

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;

-- ── 2. Deployment state ───────────────────────────────────────────────────
create table public.agent_deployments (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'review', 'ready', 'published', 'paused', 'unpublished')),
  published_at timestamptz,
  first_published_at timestamptz,
  paused_at timestamptz,
  published_by uuid references auth.users(id) on delete set null,
  -- What the launch check saw when the Agent was last published.
  launch_check jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.agent_deployments
  for each row execute function app.set_updated_at();

alter table public.agent_deployments enable row level security;
alter table public.agent_deployments force row level security;
-- Staff read their own business's deployment; every write goes through the functions below.
create policy agent_deployments_select on public.agent_deployments
  for select using (app.has_permission(tenant_id, 'agent.read'));

-- ── 3. Publish / pause ────────────────────────────────────────────────────
create or replace function public.publish_agent(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_ordering boolean;
  v_knowledge int;
  v_products int;
  v_priced int;
  v_sub public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_trial_started boolean := false;
  v_missing text[] := '{}';
  v_check jsonb;
begin
  if not app.has_permission(p_tenant_id, 'agent.write') then
    raise exception 'PERMISSION_ERROR: agent.write required' using errcode = '42501';
  end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND: business does not exist';
  end if;
  -- Suspended/closed is a Super Admin decision; publishing never overrides it.
  if v_tenant.status not in ('active', 'onboarding') then
    raise exception 'LAUNCH_BLOCKED: this business is %', v_tenant.status;
  end if;

  select coalesce((checkout ->> 'ordering_enabled')::boolean, false) into v_ordering
  from public.tenant_settings where tenant_id = p_tenant_id;
  select count(*) into v_knowledge from public.business_brain_entries
    where tenant_id = p_tenant_id and status = 'approved' and is_active;
  select count(*), count(*) filter (where price_minor > 0) into v_products, v_priced
    from public.products where tenant_id = p_tenant_id and status = 'active';

  -- Minimum launch requirements (readiness below 100% is fine).
  if not exists (select 1 from jsonb_each_text(coalesce(v_tenant.business_name, '{}'::jsonb)) where btrim(value) <> '') then
    v_missing := v_missing || 'business name'::text;
  end if;
  if v_tenant.business_type_key is null then
    v_missing := v_missing || 'business type'::text;
  end if;
  if v_knowledge = 0 and v_products = 0 then
    v_missing := v_missing || 'at least one approved piece of business information or one product'::text;
  end if;
  if v_ordering and v_priced = 0 then
    v_missing := v_missing || 'a priced product in the catalog (online ordering is on)'::text;
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception 'LAUNCH_REQUIREMENTS: %', array_to_string(v_missing, '; ');
  end if;

  -- Entitlement. A business created while `create_business` skipped the trial
  -- has no subscription at all: start the default trial it should have had.
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  if not found then
    select * into v_plan from public.subscription_plans where is_default and is_active limit 1;
    if not found then
      raise exception 'CONFIG_ERROR: no default subscription plan is seeded';
    end if;
    insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
    values (p_tenant_id, v_plan.key, 'trialing', now() + make_interval(days => v_plan.trial_days))
    returning * into v_sub;
    v_trial_started := true;
  elsif not (
    (v_sub.status = 'trialing' and v_sub.trial_ends_at > now())
    or (v_sub.status = 'active' and (v_sub.current_period_end is null or v_sub.current_period_end > now()))
  ) then
    raise exception 'PLAN_REQUIRED: the subscription is not active — choose a plan in Billing';
  end if;

  v_check := jsonb_build_object(
    'approved_knowledge', v_knowledge, 'active_products', v_products, 'priced_products', v_priced,
    'ordering_enabled', v_ordering, 'deployment_mode', v_tenant.deployment_mode, 'checked_at', now()
  );

  insert into public.agent_deployments (tenant_id, status, published_at, first_published_at, paused_at, published_by, launch_check)
  values (p_tenant_id, 'published', now(), now(), null, auth.uid(), v_check)
  on conflict (tenant_id) do update
    set status = 'published', published_at = now(), paused_at = null, published_by = auth.uid(), launch_check = v_check,
        first_published_at = coalesce(public.agent_deployments.first_published_at, now());

  -- A business created while `create_business` left it in `onboarding` is
  -- activated by its first publish (nothing else ever moves it out).
  if v_tenant.status = 'onboarding' then
    update public.tenants set status = 'active' where id = p_tenant_id;
  end if;

  -- The Agent itself is switched on with the deployment (one switch, not two).
  update public.tenant_settings
    set agent = jsonb_set(coalesce(agent, '{}'::jsonb), '{active}', 'true'::jsonb)
    where tenant_id = p_tenant_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'agent.published', 'agent_deployment', p_tenant_id,
    v_check || jsonb_build_object('trial_started', v_trial_started));

  return jsonb_build_object('status', 'published', 'trial_started', v_trial_started, 'trial_ends_at', v_sub.trial_ends_at);
end;
$$;
revoke all on function public.publish_agent(uuid) from public;
revoke all on function public.publish_agent(uuid) from anon;
grant execute on function public.publish_agent(uuid) to authenticated;

create or replace function public.pause_agent(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant_id, 'agent.write') then
    raise exception 'PERMISSION_ERROR: agent.write required' using errcode = '42501';
  end if;
  update public.agent_deployments
    set status = 'paused', paused_at = now()
    where tenant_id = p_tenant_id and status = 'published';
  if not found then
    raise exception 'VALIDATION_ERROR: the Agent is not live';
  end if;
  update public.tenant_settings
    set agent = jsonb_set(coalesce(agent, '{}'::jsonb), '{active}', 'false'::jsonb)
    where tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, auth.uid(), 'agent.paused', 'agent_deployment', p_tenant_id);
end;
$$;
revoke all on function public.pause_agent(uuid) from public;
revoke all on function public.pause_agent(uuid) from anon;
grant execute on function public.pause_agent(uuid) to authenticated;
