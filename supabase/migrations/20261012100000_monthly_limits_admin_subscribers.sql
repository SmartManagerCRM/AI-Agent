-- Annual plans: monthly limits reset each month; Super Admin alerts and
-- subscription creation; the first payment after a trial.
--
-- 1. An annual plan's conversation limit and AI cost cap are monthly: usage is
--    counted month by month from the subscription's day of the month (annual
--    Starter from 25 January: 1,000 conversations and the $20 cap for
--    25 Jan–25 Feb, again for 25 Feb–25 Mar, …), never as one yearly total.
--    The annual plans created by 20261011100000 (12× the monthly values) get
--    their monthly family's values back, unless a Super Admin changed them.
-- 2. A new subscriber who signed up themselves is announced by email to the
--    Super Admins (subscription_emails, kind new_subscriber_admin).
-- 3. A business's first real payment is marked (first_payment) so its email
--    can offer the onboarding help.
-- 4. admin_create_subscriber: a Super Admin creates a business, its owner's
--    membership and its subscription (trial or active) for a given account.

-- ── 1. Monthly windows for annual plans ─────────────────────────────────
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
  v_months integer;
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
    -- An annual plan's limits are monthly: usage is counted in the month of the
    -- year that is running, from the subscription's day of the month (subscribed
    -- on 25 January → 25 Jan–25 Feb, 25 Feb–25 Mar, …), against the plan's
    -- monthly limits. Each month starts at zero (its own AI spend row too).
    if v_plan.billing_interval = 'year' and v_start <= v_now then
      v_months := (extract(year from age(v_now, v_start)) * 12 + extract(month from age(v_now, v_start)))::int;
      while v_months > 0 and v_start + make_interval(months => v_months) > v_now loop
        v_months := v_months - 1;
      end loop;
      while v_start + make_interval(months => v_months + 1) <= v_now loop
        v_months := v_months + 1;
      end loop;
      v_end := case when v_end is null then v_start + make_interval(months => v_months + 1)
                    else least(v_end, v_start + make_interval(months => v_months + 1)) end;
      v_start := v_start + make_interval(months => v_months);
    end if;
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
  -- interaction ledger (Agent AI calls only — never Business Brain analysis,
  -- never the premium voice, which is not part of the plan's AI cost cap).
  select u.ai_cost_usd, u.ai_calls into v_ai_used, v_ai_calls
  from public.ai_usage_periods u where u.tenant_id = p_tenant_id and u.period_start = v_start;
  if not found then
    select coalesce(sum(i.estimated_cost_usd), 0), count(*) filter (where i.handled_by = 'ai' and i.success)
      into v_ai_used, v_ai_calls
    from public.agent_interactions i
    where i.tenant_id = p_tenant_id and i.request_type not in ('brain_ingestion', 'voice_tts') and i.created_at >= v_start
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

update public.subscription_plans a
   set conversation_limit = m.conversation_limit
  from public.subscription_plans m
 where a.billing_interval = 'year' and a.plan_family is not null
   and m.key = a.plan_family and m.billing_interval = 'month'
   and a.conversation_limit is not distinct from m.conversation_limit * 12;

update public.ai_cost_limits a
   set limit_usd = m.limit_usd, updated_at = now()
  from public.subscription_plans p, public.ai_cost_limits m
 where a.plan_key = p.key and p.billing_interval = 'year' and p.plan_family is not null
   and m.plan_key = p.plan_family and m.tenant_id is null
   and a.limit_usd = m.limit_usd * 12;

-- ── 2. New subscribers announced to the Super Admins ────────────────────
alter table public.subscription_emails drop constraint subscription_emails_kind_check;
alter table public.subscription_emails add constraint subscription_emails_kind_check
  check (kind in ('trial_started', 'payment_received', 'upgraded', 'downgraded', 'cancel_scheduled',
                  'renewal_resumed', 'canceled', 'paused', 'payment_failed', 'new_subscriber_admin'));

-- A business that signed up (not one a Super Admin created): one email to the Super Admins.
create or replace function app.subscription_admin_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_super_admin() then
    perform app.queue_subscription_email(new.tenant_id, 'new_subscriber_admin',
      jsonb_build_object('plan_key', new.plan_key, 'status', new.status, 'trial_ends_at', new.trial_ends_at),
      'admin-new:' || new.tenant_id::text);
  end if;
  return new;
end;
$$;
revoke all on function app.subscription_admin_alert() from public, anon, authenticated;
create trigger subscription_admin_alert after insert on public.subscriptions
  for each row execute function app.subscription_admin_alert();

-- Where the app sends those (service role): the Super Admins' account emails.
create or replace function public.super_admin_recipients()
returns table(email text, full_name text, preferred_language text)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.email::text, pr.full_name, pr.preferred_language
    from public.platform_admins pa
    join public.profiles pr on pr.id = pa.user_id
   where nullif(btrim(pr.email::text), '') is not null
   order by pa.created_at;
$$;
revoke all on function public.super_admin_recipients() from public, anon, authenticated;
grant execute on function public.super_admin_recipients() to service_role;

-- ── 3. The first real payment ───────────────────────────────────────────
create or replace function app.subscription_email_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_first boolean;
begin
  -- Real payments only (the built-in test checkout moves no money).
  if new.status = 'succeeded' and new.provider <> 'mock' and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    v_first := not exists (
      select 1 from public.subscription_payments p
       where p.tenant_id = new.tenant_id and p.id <> new.id and p.status = 'succeeded' and p.provider <> 'mock');
    perform app.queue_subscription_email(new.tenant_id, 'payment_received',
      jsonb_build_object('payment_id', new.id, 'plan_key', new.plan_key, 'amount_minor', new.amount_minor,
                         'currency', new.currency, 'first_payment', v_first),
      'payment:' || new.id::text);
  end if;
  return new;
end;
$$;

-- ── 4. Super Admin: create a subscriber ─────────────────────────────────
create function public.admin_create_subscriber(
  p_owner_id uuid,
  p_business_name jsonb,
  p_business_type_key text,
  p_slug text,
  p_default_language text,
  p_currency char(3),
  p_plan_key text,
  p_status text,
  p_trial_days integer default null,
  p_period_end timestamptz default null,
  p_country text default null,
  p_contact_phone text default null,
  p_owner_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := auth.uid();
  v_tenant_id uuid;
  v_owner_role_id uuid;
  v_plan public.subscription_plans%rowtype;
  v_trial_days integer;
  v_end timestamptz;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_owner_id) then
    raise exception 'VALIDATION_ERROR: unknown owner account' using errcode = '22023';
  end if;
  if p_status not in ('trialing', 'active') then
    raise exception 'VALIDATION_ERROR: status must be trialing or active' using errcode = '22023';
  end if;
  select * into v_plan from public.subscription_plans where key = p_plan_key and is_active;
  if not found then
    raise exception 'VALIDATION_ERROR: unknown or inactive plan' using errcode = '22023';
  end if;
  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  v_trial_days := coalesce(p_trial_days, v_plan.trial_days);
  if p_status = 'trialing' and (v_trial_days < 1 or v_trial_days > 365) then
    raise exception 'VALIDATION_ERROR: trial days must be between 1 and 365' using errcode = '22023';
  end if;
  v_end := coalesce(p_period_end, now() + case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end);
  if p_status = 'active' and v_end <= now() then
    raise exception 'VALIDATION_ERROR: the paid period must end in the future' using errcode = '22023';
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency, status,
                              country, contact_phone)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency, 'active',
          nullif(btrim(left(p_country, 80)), ''), nullif(btrim(left(p_contact_phone, 40)), ''))
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);
  insert into public.tenant_payment_config (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  if p_status = 'trialing' then
    insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
    values (v_tenant_id, v_plan.key, 'trialing', now() + make_interval(days => v_trial_days));
  else
    insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end)
    values (v_tenant_id, v_plan.key, 'active', now(), now(), v_end);
  end if;

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, p_owner_id, v_owner_role_id, 'active');

  if nullif(btrim(p_owner_name), '') is not null then
    update public.profiles set full_name = left(btrim(p_owner_name), 120)
     where id = p_owner_id and coalesce(btrim(full_name), '') = '';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_tenant_id, v_admin, 'tenant.created_by_admin', 'tenant', v_tenant_id,
          jsonb_build_object('owner_id', p_owner_id, 'plan_key', v_plan.key, 'status', p_status));

  return v_tenant_id;
end;
$$;
revoke all on function public.admin_create_subscriber(uuid, jsonb, text, text, text, char(3), text, text, integer, timestamptz, text, text, text)
  from public, anon;
grant execute on function public.admin_create_subscriber(uuid, jsonb, text, text, text, char(3), text, text, integer, timestamptz, text, text, text)
  to authenticated;
