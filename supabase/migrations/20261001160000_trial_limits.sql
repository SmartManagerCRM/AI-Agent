-- Trial limits: the free trial ends after its days (trial_ends_at, as
-- before) OR after 500 customer conversations OR after $0.50 of Agent AI
-- cost — whichever comes first. Ending early has exactly the effect the
-- end date already has (the Agent is no longer entitled), recorded
-- server-side in `subscriptions.trial_limit_reached_at` so every
-- entitlement check sees it.
--
-- * Both limits are Super Admin settings (`usage_settings`, Super-Admin-only
--   RLS); the AI dollar limit is never returned to a subscriber.
-- * The trial window runs from the subscription's creation (go-live starts
--   the trial) to trial_ends_at — unaffected if an end date is extended.
-- * Trial AI spend uses the same reservation ledger as paid plans, so
--   concurrent calls can't overshoot $0.50 either. Business Brain analysis
--   is never part of it.
-- * Spend already recorded in the interaction ledger before this
--   migration seeds the per-period counter the first time a period is
--   used (paid periods too), so nothing spent so far is forgotten.

alter table public.subscriptions
  add column trial_limit_reached_at timestamptz,
  add column trial_limit_reason text check (trial_limit_reason in ('conversation_limit', 'ai_cost_limit'));

alter table public.usage_settings
  add column trial_conversation_limit integer default 500 check (trial_conversation_limit is null or trial_conversation_limit > 0),
  add column trial_ai_cost_limit_usd numeric(10, 2) default 0.50 check (trial_ai_cost_limit_usd is null or trial_ai_cost_limit_usd >= 0);

create or replace function app.usage_snapshot(p_tenant_id uuid, p_record boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_settings public.usage_settings%rowtype;
  v_now timestamptz := now();
  v_paid boolean;
  v_trial boolean;
  v_trial_end text;
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
  v_trial := v_sub.status = 'trialing';

  -- The period usage is counted in: the trial window, or the paid billing period.
  if v_trial then
    v_end := v_sub.trial_ends_at;
    v_start := v_sub.created_at;
    v_conv_limit := v_settings.trial_conversation_limit;
    v_ai_limit := v_settings.trial_ai_cost_limit_usd;
  else
    v_end := v_sub.current_period_end;
    v_start := coalesce(
      v_sub.current_period_start,
      v_sub.current_period_end - case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end,
      date_trunc('month', v_now)
    );
    v_conv_limit := coalesce(v_sub.conversation_limit_override, v_plan.conversation_limit);
    -- AI cost cap: subscriber override, else plan default.
    v_ai_limit := coalesce(
      (select l.limit_usd from public.ai_cost_limits l where l.tenant_id = p_tenant_id),
      (select l.limit_usd from public.ai_cost_limits l where l.plan_key = v_sub.plan_key)
    );
  end if;

  -- Customer conversations in the period: one conversation = one session, however many messages.
  select count(*)::int into v_conv_used
  from public.conversations c
  where c.tenant_id = p_tenant_id and c.last_message_at >= v_start and (v_end is null or c.last_message_at < v_end);

  -- AI spend in the period. First use of a period: seed it from the
  -- interaction ledger (Agent calls only, never Business Brain analysis).
  select u.ai_cost_usd, u.ai_calls into v_ai_used, v_ai_calls
  from public.ai_usage_periods u where u.tenant_id = p_tenant_id and u.period_start = v_start;
  if not found then
    select coalesce(sum(i.estimated_cost_usd), 0), count(*) filter (where i.handled_by = 'ai' and i.success)
      into v_ai_used, v_ai_calls
    from public.agent_interactions i
    where i.tenant_id = p_tenant_id and i.request_type <> 'brain_ingestion' and i.created_at >= v_start
      and (v_end is null or i.created_at < v_end);
    if p_record then
      insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd, ai_calls)
      values (p_tenant_id, v_start, v_ai_used, v_ai_calls)
      on conflict (tenant_id, period_start) do nothing;
    end if;
  end if;
  select coalesce(sum(r.amount_usd), 0) into v_ai_reserved
  from public.ai_cost_reservations r
  where r.tenant_id = p_tenant_id and r.period_start = v_start and r.expires_at > v_now;

  if v_trial then
    -- No grace period on a trial: more than the trial's conversations, or
    -- its AI allowance used up, ends the trial (like the end date does).
    v_reached := null;
    v_grace := null;
    v_trial_end := case
      when v_sub.trial_ends_at <= v_now then 'expired'
      when v_conv_limit is not null and v_conv_used > v_conv_limit then 'conversation_limit'
      when v_ai_limit is not null and v_ai_used >= v_ai_limit then 'ai_cost_limit'
    end;
    v_conv_state := case when v_conv_limit is not null and v_conv_used > v_conv_limit then 'blocked' else 'ok' end;
    if p_record then
      if v_trial_end in ('conversation_limit', 'ai_cost_limit') and v_sub.trial_limit_reached_at is null then
        update public.subscriptions
          set trial_limit_reached_at = v_now, trial_limit_reason = v_trial_end
          where tenant_id = p_tenant_id;
        insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
        values (p_tenant_id, null, 'usage.trial_limit_reached', 'subscription', p_tenant_id,
          jsonb_build_object('reason', v_trial_end, 'conversations', v_conv_used, 'conversation_limit', v_conv_limit));
      elsif v_trial_end is distinct from 'conversation_limit' and v_trial_end is distinct from 'ai_cost_limit'
            and v_sub.trial_limit_reached_at is not null and v_sub.trial_ends_at > v_now then
        -- Super Admin raised the trial limits: the trial is back on.
        update public.subscriptions set trial_limit_reached_at = null, trial_limit_reason = null where tenant_id = p_tenant_id;
      end if;
    end if;
  else
    -- Paid: reaching the conversation limit starts a grace period.
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
  end if;

  v_ai_state := case
    when not (v_paid or v_trial) or v_ai_limit is null then 'ok'
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
    when v_trial then case when v_trial_end is not null then 'TRIAL_ENDED' else 'TRIAL' end
    when not v_paid then 'NOT_ACTIVE'
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
    'is_trial', v_trial,
    'trial_ended', v_trial_end is not null,
    'trial_end_reason', v_trial_end,
    'trial_ends_at', case when v_trial then v_sub.trial_ends_at end,
    'status', v_sub.status,
    'plan_key', v_sub.plan_key,
    'period_start', v_start,
    'period_end', v_end,
    'conversation_limit', v_conv_limit,
    'conversation_limit_default', case when v_trial then v_settings.trial_conversation_limit else v_plan.conversation_limit end,
    'conversation_limit_override', case when v_trial then null else v_sub.conversation_limit_override end,
    'conversations_used', v_conv_used,
    'conversation_percent', v_conv_pct,
    'conversation_warning_level', v_warn_level,
    'grace_period_hours', case when v_trial then 0 else v_plan.grace_period_hours end,
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

-- Subscriber view: never AI dollar figures, percentages or AI states. A
-- trial that ended on its AI allowance is reported as a generic "usage
-- limit", never as an AI cost.
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
  return (v - 'ai_cost_limit' - 'ai_cost_used' - 'ai_cost_reserved' - 'ai_calls' - 'ai_cost_percent' - 'ai_state'
            - 'usage_state' - 'conversation_limit_default' - 'conversation_limit_override' - 'trial_end_reason')
         || jsonb_build_object(
              'ai_limited', v ->> 'ai_state' = 'blocked',
              'trial_end_reason', case v ->> 'trial_end_reason' when 'ai_cost_limit' then 'usage_limit' else v ->> 'trial_end_reason' end
            );
end;
$$;
revoke all on function public.tenant_usage_summary(uuid) from public, anon;
grant execute on function public.tenant_usage_summary(uuid) to authenticated;

-- Reserve an LLM call's estimated cost: paid periods and active trials.
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
  if v_snap is null then
    return jsonb_build_object('allowed', true, 'reservation_id', null, 'governed', false);
  end if;
  if (v_snap ->> 'is_trial')::boolean and (v_snap ->> 'trial_ended')::boolean then
    return jsonb_build_object('allowed', false, 'reason', 'trial_ended', 'governed', true);
  end if;
  -- Neither paid nor on a trial (lapsed): entitlement already refuses these; nothing to meter.
  if not (v_snap ->> 'is_paid')::boolean and not (v_snap ->> 'is_trial')::boolean then
    return jsonb_build_object('allowed', true, 'reservation_id', null, 'governed', false);
  end if;
  if v_snap ->> 'conversation_state' = 'blocked' then
    return jsonb_build_object('allowed', false, 'reason', 'conversation_limit', 'governed', true);
  end if;

  v_start := (v_snap ->> 'period_start')::timestamptz;
  v_limit := (v_snap ->> 'ai_cost_limit')::numeric;
  -- First use of the period starts from what the ledger already recorded.
  insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd, ai_calls)
    values (p_tenant_id, v_start, coalesce((v_snap ->> 'ai_cost_used')::numeric, 0), coalesce((v_snap ->> 'ai_calls')::int, 0))
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

-- Super Admin changed the trial limits: re-evaluate trials that ended on a
-- limit right away (they no longer reach the usage check on their own,
-- since entitlement already refuses them).
create or replace function app.reevaluate_trial_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.trial_conversation_limit is distinct from old.trial_conversation_limit
     or new.trial_ai_cost_limit_usd is distinct from old.trial_ai_cost_limit_usd then
    perform app.usage_snapshot(s.tenant_id, true)
    from public.subscriptions s
    where s.status = 'trialing' and s.trial_limit_reached_at is not null;
  end if;
  return null;
end;
$$;
revoke all on function app.reevaluate_trial_limits() from public, anon, authenticated;
create trigger reevaluate_trial_limits after update on public.usage_settings
  for each row execute function app.reevaluate_trial_limits();
