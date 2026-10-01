-- Subscription usage control + AI cost governance (paid subscriptions only).
--
-- The trial is untouched: it stays governed by `trial_ends_at` and the
-- existing AI cost guard. Everything below applies only while a
-- subscription is PAID (status = 'active' and the paid period hasn't
-- ended).
--
-- * Customer conversation limit per billing period — plan default
--   (`subscription_plans.conversation_limit`) or a per-subscriber override
--   (`subscriptions.conversation_limit_override`). Reaching it starts a
--   grace period (`grace_period_hours`, default 24) stored server-side;
--   after it, LLM replies stop (deterministic features keep working).
-- * AI cost limit per billing period — a HARD server-side cap. Plan
--   default or per-subscriber override, both in `ai_cost_limits`, which
--   only Super Admin can read or write (subscribers can read their own
--   plan and subscription rows, so the dollar figures can't live there).
--   Spend is counted per billing period in `ai_usage_periods` and every
--   LLM call first reserves its estimated cost under a row lock, so
--   concurrent calls cannot collectively overshoot the cap.
-- * The billing period is the one the payment flow already sets:
--   `current_period_end` = payment time + 1 month/year. Its start is now
--   recorded too (`current_period_start`). Usage is always derived from
--   the current period, so a new period starts from zero without any job.
-- * `tenant_settings.ai_monthly_budget_usd` (the older cost-guard budget)
--   was readable and writable by any subscriber with settings access; it
--   is now hidden from them at the column level.

-- ── Plan defaults (visible to subscribers for their own plan) ───────────
alter table public.subscription_plans
  add column conversation_limit integer check (conversation_limit is null or conversation_limit > 0),
  add column grace_period_hours integer not null default 24 check (grace_period_hours between 0 and 720);

update public.subscription_plans set conversation_limit = 1000 where key = 'starter';
update public.subscription_plans set conversation_limit = 5000 where key = 'growth';
update public.subscription_plans set conversation_limit = 10000 where key = 'pro';

-- ── Subscription: billing period start, conversation override, grace ────
alter table public.subscriptions
  add column current_period_start timestamptz,
  add column conversation_limit_override integer check (conversation_limit_override is null or conversation_limit_override > 0),
  add column conversation_limit_reached_at timestamptz,
  add column conversation_limit_grace_until timestamptz;

update public.subscriptions s
  set current_period_start = s.current_period_end - case p.billing_interval when 'year' then interval '1 year' else interval '1 month' end
  from public.subscription_plans p
  where p.key = s.plan_key and s.current_period_end is not null and s.current_period_start is null;

-- ── AI cost limits: Super Admin only ────────────────────────────────────
create table public.ai_cost_limits (
  id uuid primary key default gen_random_uuid(),
  plan_key text unique references public.subscription_plans(key) on delete cascade,
  tenant_id uuid unique references public.tenants(id) on delete cascade,
  limit_usd numeric(10, 2) not null check (limit_usd >= 0),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_cost_limits_one_scope check ((plan_key is null) <> (tenant_id is null))
);
create trigger set_updated_at before update on public.ai_cost_limits
  for each row execute function app.set_updated_at();
alter table public.ai_cost_limits enable row level security;
alter table public.ai_cost_limits force row level security;
create policy ai_cost_limits_select on public.ai_cost_limits for select using (app.is_super_admin());
create policy ai_cost_limits_insert on public.ai_cost_limits for insert with check (app.is_super_admin());
create policy ai_cost_limits_update on public.ai_cost_limits for update using (app.is_super_admin()) with check (app.is_super_admin());
create policy ai_cost_limits_delete on public.ai_cost_limits for delete using (app.is_super_admin());
revoke all on public.ai_cost_limits from anon;

insert into public.ai_cost_limits (plan_key, limit_usd)
select key, case key when 'starter' then 15 when 'growth' then 30 when 'pro' then 60 end
from public.subscription_plans where key in ('starter', 'growth', 'pro')
on conflict (plan_key) do nothing;

-- ── AI spend per billing period (the enforcement counter) ───────────────
create table public.ai_usage_periods (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start timestamptz not null,
  ai_cost_usd numeric(12, 6) not null default 0 check (ai_cost_usd >= 0),
  ai_calls integer not null default 0 check (ai_calls >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, period_start)
);
alter table public.ai_usage_periods enable row level security;
alter table public.ai_usage_periods force row level security;
create policy ai_usage_periods_select on public.ai_usage_periods for select using (app.is_super_admin());
revoke all on public.ai_usage_periods from anon;

-- ── In-flight LLM calls' reserved cost (expire if never settled) ────────
create table public.ai_cost_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  period_start timestamptz not null,
  amount_usd numeric(12, 6) not null check (amount_usd >= 0),
  expires_at timestamptz not null default now() + interval '2 minutes',
  created_at timestamptz not null default now()
);
create index ai_cost_reservations_tenant_idx on public.ai_cost_reservations (tenant_id, period_start, expires_at);
alter table public.ai_cost_reservations enable row level security;
alter table public.ai_cost_reservations force row level security;
revoke all on public.ai_cost_reservations from anon, authenticated;

-- ── Warning thresholds (Super Admin only; one row) ──────────────────────
create table public.usage_settings (
  id boolean primary key default true,
  conversation_warning_percents integer[] not null default array[70, 85, 95],
  ai_cost_warning_percent integer not null default 80 check (ai_cost_warning_percent between 1 and 100),
  updated_at timestamptz not null default now(),
  constraint usage_settings_single_row check (id),
  constraint usage_settings_conversation_percents check (
    cardinality(conversation_warning_percents) between 1 and 5
    and 0 < all (conversation_warning_percents) and 100 > all (conversation_warning_percents)
  )
);
create trigger set_updated_at before update on public.usage_settings
  for each row execute function app.set_updated_at();
alter table public.usage_settings enable row level security;
alter table public.usage_settings force row level security;
create policy usage_settings_select on public.usage_settings for select using (app.is_super_admin());
create policy usage_settings_update on public.usage_settings for update using (app.is_super_admin()) with check (app.is_super_admin());
revoke all on public.usage_settings from anon;
insert into public.usage_settings (id) values (true) on conflict do nothing;

-- ── The older AI budget columns: hidden from subscribers ────────────────
-- Column-level grants (RLS can't hide a column). Super Admin pages read
-- and write these with the service role after their own super-admin check.
revoke select, insert, update on public.tenant_settings from anon, authenticated;
grant select (tenant_id, agent, checkout, created_at, updated_at) on public.tenant_settings to authenticated;
grant insert (tenant_id, agent, checkout) on public.tenant_settings to authenticated;
grant update (agent, checkout) on public.tenant_settings to authenticated;
revoke select, insert, update on public.platform_settings from anon, authenticated;
grant select (id, platform_name, logo_path, supported_languages, supported_currencies, maintenance_mode, created_at, updated_at)
  on public.platform_settings to authenticated;
grant update (platform_name, logo_path, supported_languages, supported_currencies, maintenance_mode)
  on public.platform_settings to authenticated;

-- ── Usage snapshot (internal; includes AI dollar figures) ───────────────
-- p_record: persist the conversation-threshold timestamps (start of the
-- grace period, or clearing them once usage is back under the limit).
create or replace function app.usage_snapshot(p_tenant_id uuid, p_record boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_now timestamptz := now();
  v_paid boolean;
  v_start timestamptz;
  v_end timestamptz;
  v_conv_limit integer;
  v_conv_used integer;
  v_reached timestamptz;
  v_grace timestamptz;
  v_conv_state text;
  v_ai_limit numeric;
  v_ai_used numeric;
  v_ai_reserved numeric;
  v_ai_calls integer;
  v_ai_state text;
  v_settings public.usage_settings%rowtype;
  v_conv_pct numeric;
  v_warn_level integer;
  v_ai_pct numeric;
  v_state text;
begin
  if p_record then
    select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  else
    select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  end if;
  if not found then
    return null;
  end if;
  select * into v_plan from public.subscription_plans where key = v_sub.plan_key;
  select * into v_settings from public.usage_settings where id;
  v_settings.conversation_warning_percents := coalesce(v_settings.conversation_warning_percents, array[70, 85, 95]);
  v_settings.ai_cost_warning_percent := coalesce(v_settings.ai_cost_warning_percent, 80);

  v_paid := v_sub.status = 'active' and (v_sub.current_period_end is null or v_sub.current_period_end > v_now);
  v_end := v_sub.current_period_end;
  v_start := coalesce(
    v_sub.current_period_start,
    v_sub.current_period_end - case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end,
    date_trunc('month', v_now)
  );

  -- Customer conversations handled this period: one conversation = one session, however many messages.
  v_conv_limit := coalesce(v_sub.conversation_limit_override, v_plan.conversation_limit);
  select count(*)::int into v_conv_used
  from public.conversations c
  where c.tenant_id = p_tenant_id and c.last_message_at >= v_start and (v_end is null or c.last_message_at < v_end);

  -- Threshold timestamps only count inside the current period (a new period starts clean).
  v_reached := case when v_sub.conversation_limit_reached_at >= v_start then v_sub.conversation_limit_reached_at end;
  v_grace := case when v_reached is not null then v_sub.conversation_limit_grace_until end;

  if not v_paid or v_conv_limit is null or v_conv_used < v_conv_limit then
    v_conv_state := 'ok';
    if p_record and v_sub.conversation_limit_reached_at is not null then
      update public.subscriptions
        set conversation_limit_reached_at = null, conversation_limit_grace_until = null
        where tenant_id = p_tenant_id;
    end if;
    v_reached := null;
    v_grace := null;
  else
    if v_reached is null then
      v_reached := v_now;
      v_grace := v_now + make_interval(hours => v_plan.grace_period_hours);
      if p_record then
        update public.subscriptions
          set conversation_limit_reached_at = v_reached, conversation_limit_grace_until = v_grace
          where tenant_id = p_tenant_id;
        insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
        values (p_tenant_id, null, 'usage.conversation_limit_reached', 'subscription', p_tenant_id,
          jsonb_build_object('limit', v_conv_limit, 'used', v_conv_used, 'grace_until', v_grace));
      end if;
    end if;
    v_conv_state := case when v_now < v_grace then 'grace' else 'blocked' end;
  end if;

  -- AI cost this period (hard cap; subscriber override, else plan default).
  v_ai_limit := coalesce(
    (select l.limit_usd from public.ai_cost_limits l where l.tenant_id = p_tenant_id),
    (select l.limit_usd from public.ai_cost_limits l where l.plan_key = v_sub.plan_key)
  );
  select coalesce(u.ai_cost_usd, 0), coalesce(u.ai_calls, 0) into v_ai_used, v_ai_calls
  from public.ai_usage_periods u where u.tenant_id = p_tenant_id and u.period_start = v_start;
  v_ai_used := coalesce(v_ai_used, 0);
  v_ai_calls := coalesce(v_ai_calls, 0);
  select coalesce(sum(r.amount_usd), 0) into v_ai_reserved
  from public.ai_cost_reservations r
  where r.tenant_id = p_tenant_id and r.period_start = v_start and r.expires_at > v_now;
  v_ai_state := case
    when not v_paid or v_ai_limit is null then 'ok'
    when v_ai_used >= v_ai_limit then 'blocked'
    when v_ai_used >= v_ai_limit * v_settings.ai_cost_warning_percent / 100.0 then 'warning'
    else 'ok'
  end;
  v_ai_pct := case when v_ai_limit > 0 then round(100.0 * v_ai_used / v_ai_limit, 1) when v_ai_limit = 0 then 100 end;

  -- Conversation warning level: 0, one of the configured percents, or 100.
  v_conv_pct := case when v_conv_limit > 0 then round(100.0 * v_conv_used / v_conv_limit, 1) end;
  v_warn_level := case
    when v_conv_pct is null then 0
    when v_conv_used >= v_conv_limit then 100
    else coalesce((select max(t) from unnest(v_settings.conversation_warning_percents) t where v_conv_pct >= t), 0)
  end;

  v_state := case
    when not v_paid then case when v_sub.status = 'trialing' then 'TRIAL' else 'NOT_ACTIVE' end
    when v_conv_state <> 'ok' and v_ai_state = 'blocked' then 'BOTH_LIMITS_REACHED'
    when v_ai_state = 'blocked' then 'AI_COST_LIMIT_REACHED'
    when v_conv_state = 'blocked' then 'CONVERSATION_LIMIT_REACHED'
    when v_conv_state = 'grace' then 'CONVERSATION_GRACE_PERIOD'
    when v_ai_state = 'warning' then 'AI_COST_WARNING'
    when v_warn_level > 0 then 'CONVERSATION_WARNING'
    else 'ACTIVE'
  end;

  return jsonb_build_object(
    'is_paid', v_paid,
    'status', v_sub.status,
    'plan_key', v_sub.plan_key,
    'period_start', v_start,
    'period_end', v_end,
    'conversation_limit', v_conv_limit,
    'conversation_limit_default', v_plan.conversation_limit,
    'conversation_limit_override', v_sub.conversation_limit_override,
    'conversations_used', v_conv_used,
    'conversation_percent', v_conv_pct,
    'conversation_warning_level', v_warn_level,
    'grace_period_hours', v_plan.grace_period_hours,
    'limit_reached_at', v_reached,
    'grace_until', v_grace,
    'conversation_state', v_conv_state,
    'ai_cost_limit', v_ai_limit,
    'ai_cost_used', v_ai_used,
    'ai_cost_reserved', v_ai_reserved,
    'ai_calls', v_ai_calls,
    'ai_cost_percent', v_ai_pct,
    'ai_state', v_ai_state,
    'usage_state', v_state
  );
end;
$$;
revoke all on function app.usage_snapshot(uuid, boolean) from public, anon, authenticated;

-- ── Subscriber view: conversation usage only, never AI dollar figures ───
create or replace function public.tenant_usage_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not app.has_permission(p_tenant_id, 'business.read') then
    raise exception 'PERMISSION_ERROR: business access required' using errcode = '42501';
  end if;
  v := app.usage_snapshot(p_tenant_id, true);
  if v is null then
    return null;
  end if;
  -- Never AI dollar figures, percentages or AI states: only "AI is limited".
  return (v - 'ai_cost_limit' - 'ai_cost_used' - 'ai_cost_reserved' - 'ai_calls' - 'ai_cost_percent' - 'ai_state'
            - 'usage_state' - 'conversation_limit_default' - 'conversation_limit_override')
         || jsonb_build_object('ai_limited', v ->> 'ai_state' = 'blocked');
end;
$$;
revoke all on function public.tenant_usage_summary(uuid) from public, anon;
grant execute on function public.tenant_usage_summary(uuid) to authenticated;

-- ── Server-only guard functions (the Agent gateway, service role) ───────
create or replace function public.ai_usage_check(p_tenant_id uuid)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select app.usage_snapshot(p_tenant_id, true);
$$;
revoke all on function public.ai_usage_check(uuid) from public, anon, authenticated;
grant execute on function public.ai_usage_check(uuid) to service_role;

-- Reserve an LLM call's estimated cost. Serialized per tenant by the
-- period row lock, so concurrent calls see each other's reservations.
create or replace function public.reserve_ai_cost(p_tenant_id uuid, p_estimate_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_snap jsonb;
  v_start timestamptz;
  v_limit numeric;
  v_used numeric;
  v_reserved numeric;
  v_id uuid;
begin
  v_snap := app.usage_snapshot(p_tenant_id, false);
  -- Not on a paid subscription (trial or none): the new caps don't apply.
  if v_snap is null or not (v_snap ->> 'is_paid')::boolean then
    return jsonb_build_object('allowed', true, 'reservation_id', null, 'governed', false);
  end if;
  if v_snap ->> 'conversation_state' = 'blocked' then
    return jsonb_build_object('allowed', false, 'reason', 'conversation_limit', 'governed', true);
  end if;

  v_start := (v_snap ->> 'period_start')::timestamptz;
  v_limit := (v_snap ->> 'ai_cost_limit')::numeric;
  insert into public.ai_usage_periods (tenant_id, period_start) values (p_tenant_id, v_start)
    on conflict (tenant_id, period_start) do nothing;
  select u.ai_cost_usd into v_used from public.ai_usage_periods u
    where u.tenant_id = p_tenant_id and u.period_start = v_start
    for update;

  delete from public.ai_cost_reservations r where r.tenant_id = p_tenant_id and r.expires_at <= now();
  select coalesce(sum(r.amount_usd), 0) into v_reserved from public.ai_cost_reservations r
    where r.tenant_id = p_tenant_id and r.period_start = v_start;

  if v_limit is not null and (v_used >= v_limit or v_used + v_reserved + greatest(p_estimate_usd, 0) > v_limit) then
    return jsonb_build_object('allowed', false, 'reason', 'ai_cost_limit', 'governed', true);
  end if;

  insert into public.ai_cost_reservations (tenant_id, period_start, amount_usd)
    values (p_tenant_id, v_start, greatest(p_estimate_usd, 0))
    returning id into v_id;
  return jsonb_build_object('allowed', true, 'reservation_id', v_id, 'governed', true);
end;
$$;
revoke all on function public.reserve_ai_cost(uuid, numeric) from public, anon, authenticated;
grant execute on function public.reserve_ai_cost(uuid, numeric) to service_role;

-- Settle a reservation with the call's actual cost (0 when the call failed).
create or replace function public.settle_ai_cost(p_tenant_id uuid, p_reservation_id uuid, p_actual_usd numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
begin
  delete from public.ai_cost_reservations r
    where r.id = p_reservation_id and r.tenant_id = p_tenant_id
    returning r.period_start into v_start;
  if v_start is null then
    v_start := (app.usage_snapshot(p_tenant_id, false) ->> 'period_start')::timestamptz;
  end if;
  if v_start is null then
    return;
  end if;
  insert into public.ai_usage_periods as u (tenant_id, period_start, ai_cost_usd, ai_calls)
    values (p_tenant_id, v_start, greatest(p_actual_usd, 0), case when p_actual_usd > 0 then 1 else 0 end)
    on conflict (tenant_id, period_start) do update
      set ai_cost_usd = u.ai_cost_usd + excluded.ai_cost_usd,
          ai_calls = u.ai_calls + excluded.ai_calls,
          updated_at = now();
end;
$$;
revoke all on function public.settle_ai_cost(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.settle_ai_cost(uuid, uuid, numeric) to service_role;

-- ── Super Admin: usage across all subscribers ───────────────────────────
-- One business (p_tenant_id) or all of them.
create or replace function public.platform_usage_overview(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_data order by row_data ->> 'business_name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'tenant_id', t.id,
      'slug', t.slug,
      'business_name', coalesce(t.business_name ->> 'en', t.business_name ->> (select k from jsonb_object_keys(t.business_name) k limit 1), t.slug),
      'tenant_status', t.status,
      'ai_cost_limit_default', (select l.limit_usd from public.ai_cost_limits l where l.plan_key = s.plan_key),
      'ai_cost_limit_override', (select l.limit_usd from public.ai_cost_limits l where l.tenant_id = t.id),
      'agent_ai_cost', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type <> 'brain_ingestion'
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'agent_ai_responses', (select count(*) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type <> 'brain_ingestion' and i.handled_by = 'ai' and i.success
            and i.created_at >= (snap ->> 'period_start')::timestamptz),
      'brain_ai_cost', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'brain_ingestion'
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'brain_ai_cost_total', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'brain_ingestion'), 0)
    ) || snap as row_data
    from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    cross join lateral (select app.usage_snapshot(t.id, false) as snap) x
    where p_tenant_id is null or t.id = p_tenant_id
  ) rows;
  return v_rows;
end;
$$;
revoke all on function public.platform_usage_overview(uuid) from public, anon;
grant execute on function public.platform_usage_overview(uuid) to authenticated;

create or replace function public.set_subscription_usage_overrides(
  p_tenant_id uuid,
  p_conversation_limit integer,
  p_ai_cost_limit numeric
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  if p_conversation_limit is not null and p_conversation_limit <= 0 then
    raise exception 'VALIDATION_ERROR: conversation limit must be positive';
  end if;
  if p_ai_cost_limit is not null and p_ai_cost_limit < 0 then
    raise exception 'VALIDATION_ERROR: AI cost limit cannot be negative';
  end if;

  update public.subscriptions set conversation_limit_override = p_conversation_limit where tenant_id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND: this business has no subscription';
  end if;

  if p_ai_cost_limit is null then
    delete from public.ai_cost_limits where tenant_id = p_tenant_id;
  else
    insert into public.ai_cost_limits (tenant_id, limit_usd, updated_by) values (p_tenant_id, p_ai_cost_limit, auth.uid())
      on conflict (tenant_id) do update set limit_usd = excluded.limit_usd, updated_by = excluded.updated_by;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'usage.overrides_set', 'subscription', p_tenant_id,
    jsonb_build_object('conversation_limit_override', p_conversation_limit, 'ai_cost_limit_override', p_ai_cost_limit));
end;
$$;
revoke all on function public.set_subscription_usage_overrides(uuid, integer, numeric) from public, anon;
grant execute on function public.set_subscription_usage_overrides(uuid, integer, numeric) to authenticated;

create or replace function public.set_plan_usage_limits(
  p_plan_key text,
  p_conversation_limit integer,
  p_ai_cost_limit numeric,
  p_grace_period_hours integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  if p_conversation_limit is not null and p_conversation_limit <= 0 then
    raise exception 'VALIDATION_ERROR: conversation limit must be positive';
  end if;
  if p_ai_cost_limit is not null and p_ai_cost_limit < 0 then
    raise exception 'VALIDATION_ERROR: AI cost limit cannot be negative';
  end if;
  if p_grace_period_hours is null or p_grace_period_hours not between 0 and 720 then
    raise exception 'VALIDATION_ERROR: grace period must be between 0 and 720 hours';
  end if;

  update public.subscription_plans
    set conversation_limit = p_conversation_limit, grace_period_hours = p_grace_period_hours
    where key = p_plan_key;
  if not found then
    raise exception 'NOT_FOUND: plan does not exist';
  end if;

  if p_ai_cost_limit is null then
    delete from public.ai_cost_limits where plan_key = p_plan_key;
  else
    insert into public.ai_cost_limits (plan_key, limit_usd, updated_by) values (p_plan_key, p_ai_cost_limit, auth.uid())
      on conflict (plan_key) do update set limit_usd = excluded.limit_usd, updated_by = excluded.updated_by;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (null, auth.uid(), 'usage.plan_limits_set', 'subscription_plan', null,
    jsonb_build_object('plan', p_plan_key, 'conversation_limit', p_conversation_limit,
      'ai_cost_limit', p_ai_cost_limit, 'grace_period_hours', p_grace_period_hours));
end;
$$;
revoke all on function public.set_plan_usage_limits(text, integer, numeric, integer) from public, anon;
grant execute on function public.set_plan_usage_limits(text, integer, numeric, integer) to authenticated;

-- ── Payment: record the period start (same period the payment sets) ─────
create or replace function public.mark_subscription_payment_succeeded(p_payment_id uuid, p_provider_event_id text, p_raw jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_period_length interval;
begin
  select * into v_payment from public.subscription_payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: subscription payment does not exist';
  end if;

  begin
    insert into public.payment_webhook_events (provider, event_id, payload)
    values (v_payment.provider, p_provider_event_id, p_raw);
  exception when unique_violation then
    return;
  end;

  if v_payment.status = 'succeeded' then
    return;
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'VALIDATION_ERROR: subscription payment % is % and cannot be marked succeeded', p_payment_id, v_payment.status;
  end if;

  select * into v_plan from public.subscription_plans where key = v_payment.plan_key;
  v_period_length := case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end;

  update public.subscription_payments set status = 'succeeded', raw_verification = p_raw where id = p_payment_id;

  update public.subscriptions
    set plan_key = v_payment.plan_key, status = 'active',
        current_period_start = now(), current_period_end = now() + v_period_length,
        conversation_limit_reached_at = null, conversation_limit_grace_until = null
    where tenant_id = v_payment.tenant_id;

  update public.tenants set status = 'active' where id = v_payment.tenant_id and status = 'suspended';

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_payment.tenant_id, null, 'subscription.payment_succeeded', 'subscription_payment', p_payment_id);
end;
$$;
