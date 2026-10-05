-- Plan changes: upgrades now, downgrades at the next billing cycle.
--
--   * An upgrade applies right away: Paddle charges the pro-rata difference to
--     the subscriber's payment method first, and the change is refused (nothing
--     changes) when that payment fails (src/server/billing/paddle/).
--   * A downgrade is scheduled: the current plan stays until the end of the
--     paid period (monthly or annual) — no refund or credit for the rest of it —
--     and the next billing cycle starts on the new plan. Moving from an annual
--     plan to a monthly one is always such a change.
--
-- Which change is which is decided here (app.plan_change_direction) and
-- mirrored in src/lib/billing/plan-change.ts: a plan's tier is its family's
-- monthly price (Starter < Growth < Pro), whatever its billing cycle.

-- ── 1. The scheduled change ──────────────────────────────────────────────
alter table public.subscriptions
  add column scheduled_plan_key text references public.subscription_plans(key) on update cascade,
  -- When it takes effect: the end of the paid period at the time it was requested.
  add column scheduled_change_at timestamptz,
  add constraint subscriptions_scheduled_change_check
    check ((scheduled_plan_key is null) = (scheduled_change_at is null));
grant select (scheduled_plan_key, scheduled_change_at) on public.subscriptions to authenticated;

-- ── 2. Upgrade or downgrade ──────────────────────────────────────────────
-- A plan's tier: the monthly price of its family's monthly plan (an annual
-- plan is the same tier as its monthly one), else its own price per month.
create or replace function app.plan_tier_price(p_plan_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select f.price_minor::numeric from public.subscription_plans f
      where f.key = p.plan_family and f.billing_interval = 'month' and f.currency = p.currency),
    case p.billing_interval when 'year' then p.price_minor / 12.0 else p.price_minor::numeric end)
    from public.subscription_plans p where p.key = p_plan_key;
$$;

-- 'upgrade' (applies now, charged pro rata), 'downgrade' (at the next billing
-- cycle) or 'same'. Annual → monthly is always a downgrade; monthly → annual
-- of the same tier is an upgrade.
create or replace function app.plan_change_direction(p_from text, p_to text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from public.subscription_plans%rowtype;
  v_to public.subscription_plans%rowtype;
  v_from_tier numeric;
  v_to_tier numeric;
begin
  if p_from is not distinct from p_to then
    return 'same';
  end if;
  select * into v_from from public.subscription_plans where key = p_from;
  select * into v_to from public.subscription_plans where key = p_to;
  if v_from.key is null or v_to.key is null then
    return 'upgrade';
  end if;
  if v_from.billing_interval = 'year' and v_to.billing_interval = 'month' then
    return 'downgrade';
  end if;
  v_from_tier := app.plan_tier_price(p_from);
  v_to_tier := app.plan_tier_price(p_to);
  if v_to_tier > v_from_tier then
    return 'upgrade';
  elsif v_to_tier < v_from_tier then
    return 'downgrade';
  elsif v_from.billing_interval = 'month' and v_to.billing_interval = 'year' then
    return 'upgrade';
  elsif v_to.price_minor < v_from.price_minor then
    return 'downgrade';
  end if;
  return 'upgrade';
end;
$$;
revoke all on function app.plan_tier_price(text) from public, anon, authenticated;
revoke all on function app.plan_change_direction(text, text) from public, anon, authenticated;

-- ── 3. Scheduling a downgrade (and withdrawing it) ───────────────────────
-- The subscriber (billing.write) or a Super Admin. The app first sets the
-- lower plan's price in Paddle for the next renewal (billing nothing now),
-- then records it here; withdrawing it sets the current plan's price back.
create or replace function public.schedule_plan_downgrade(p_tenant_id uuid, p_plan_key text)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if not (app.has_permission(p_tenant_id, 'billing.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: billing.write required' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if not found or v_sub.status <> 'active' or v_sub.current_period_end is null or v_sub.current_period_end <= now() then
    raise exception 'VALIDATION_ERROR: no paid period to change at the end of' using errcode = '22023';
  end if;
  if v_sub.cancel_at is not null then
    raise exception 'VALIDATION_ERROR: the subscription is cancelled at the end of the period' using errcode = '22023';
  end if;
  if not exists (select 1 from public.subscription_plans where key = p_plan_key and is_active) then
    raise exception 'VALIDATION_ERROR: unknown or inactive plan' using errcode = '22023';
  end if;
  if app.plan_change_direction(v_sub.plan_key, p_plan_key) <> 'downgrade' then
    raise exception 'VALIDATION_ERROR: not a downgrade' using errcode = '22023';
  end if;

  update public.subscriptions
     set scheduled_plan_key = p_plan_key,
         scheduled_change_at = v_sub.current_period_end
   where tenant_id = p_tenant_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'subscription.downgrade_scheduled', 'subscription', null,
          jsonb_build_object('from', v_sub.plan_key, 'to', p_plan_key, 'effective_at', v_sub.current_period_end));
  return v_sub.current_period_end;
end;
$$;

-- Returns the plan that was scheduled (null when there was none).
create or replace function public.cancel_plan_downgrade(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  if not (app.has_permission(p_tenant_id, 'billing.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: billing.write required' using errcode = '42501';
  end if;
  select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  if not found or v_sub.scheduled_plan_key is null then
    return null;
  end if;
  update public.subscriptions set scheduled_plan_key = null, scheduled_change_at = null where tenant_id = p_tenant_id;
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'subscription.downgrade_canceled', 'subscription', null,
          jsonb_build_object('plan', v_sub.plan_key, 'was_scheduled', v_sub.scheduled_plan_key));
  return v_sub.scheduled_plan_key;
end;
$$;
revoke all on function public.schedule_plan_downgrade(uuid, text) from public, anon;
revoke all on function public.cancel_plan_downgrade(uuid) from public, anon;
grant execute on function public.schedule_plan_downgrade(uuid, text) to authenticated;
grant execute on function public.cancel_plan_downgrade(uuid) to authenticated;

-- A plan change (whoever makes it), a new billing period from its date, or
-- the end of the subscription settles a scheduled one.
create or replace function app.settle_scheduled_plan_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_plan_key is not null
     and (new.plan_key is distinct from old.plan_key or new.status = 'canceled'
          or new.current_period_start >= new.scheduled_change_at) then
    new.scheduled_plan_key := null;
    new.scheduled_change_at := null;
  end if;
  return new;
end;
$$;
create trigger subscriptions_settle_scheduled_change before update on public.subscriptions
  for each row execute function app.settle_scheduled_plan_change();

-- ── 4. The billing page's view of the Paddle subscription ────────────────
drop function public.paddle_billing_subscription(uuid);
create function public.paddle_billing_subscription(p_tenant_id uuid)
returns table(paddle_subscription_id text, paddle_customer_id text, status text, plan_key text, cancel_at timestamptz,
              current_period_end timestamptz, scheduled_plan_key text, scheduled_change_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_tenant_id, 'billing.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: billing.write required' using errcode = '42501';
  end if;
  return query
    select s.paddle_subscription_id, s.paddle_customer_id, s.status, s.plan_key, s.cancel_at,
           s.current_period_end, s.scheduled_plan_key, s.scheduled_change_at
      from public.subscriptions s where s.tenant_id = p_tenant_id;
end;
$$;
revoke all on function public.paddle_billing_subscription(uuid) from public, anon;
grant execute on function public.paddle_billing_subscription(uuid) to authenticated;

-- ── 5. Paddle's events: a downgrade waits for the end of the paid period ──
-- A scheduled downgrade already carries the lower plan's price in Paddle (for
-- the next renewal), so its subscription events name it; until the paid period
-- ends the plan stays — scheduled here yet or not. The renewal's payment
-- (record_paddle_payment) then moves the plan.
create or replace function public.apply_paddle_subscription_event(
  p_event_id text,
  p_occurred_at timestamptz,
  p_paddle_subscription_id text,
  p_transaction_id text,
  p_paddle_customer_id text,
  p_status text,
  p_cancel_at timestamptz,
  p_plan_key text,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_tenant_id uuid;
  v_plan_key text;
begin
  select tenant_id into v_tenant_id from public.subscriptions where paddle_subscription_id = p_paddle_subscription_id;
  if v_tenant_id is null and p_transaction_id is not null then
    select tenant_id into v_tenant_id from public.subscription_payments
     where provider = 'paddle' and provider_intent_id = p_transaction_id;
  end if;
  if v_tenant_id is null then
    return 'unknown';
  end if;

  begin
    insert into public.payment_webhook_events (provider, event_id, payload) values ('paddle', p_event_id, p_raw);
  exception when unique_violation then
    return 'duplicate';
  end;

  select * into v_sub from public.subscriptions where tenant_id = v_tenant_id for update;
  -- Found through its checkout: a new Paddle subscription replaces any earlier one.
  -- (Events of a replaced one find no subscriber above, and are ignored.)
  update public.subscriptions
     set paddle_subscription_id = p_paddle_subscription_id,
         paddle_customer_id = coalesce(p_paddle_customer_id, paddle_customer_id)
   where tenant_id = v_tenant_id;

  if v_sub.paddle_event_at is not null and p_occurred_at < v_sub.paddle_event_at then
    return 'stale';
  end if;

  v_plan_key := (select key from public.subscription_plans where key = p_plan_key);
  -- A lower plan before the end of the paid period: not yet.
  if v_plan_key is not null and v_sub.current_period_end > now()
     and app.plan_change_direction(v_sub.plan_key, v_plan_key) = 'downgrade' then
    v_plan_key := null;
  end if;
  perform set_config('app.paddle_status', coalesce(p_status, ''), true);

  update public.subscriptions
     set paddle_event_at = p_occurred_at,
         cancel_at = case when p_status = 'canceled' then null else p_cancel_at end,
         status = case
           when p_status = 'canceled' then 'canceled'
           when p_status in ('past_due', 'paused') then 'past_due'
           -- Back to active after a late payment, once a paid period is recorded.
           when p_status = 'active' and status = 'past_due' and current_period_end > now() then 'active'
           else status
         end,
         canceled_at = case when p_status = 'canceled' then coalesce(canceled_at, now()) else canceled_at end,
         -- A plan change Paddle applied (the price carries its plan), for an already paid subscription.
         plan_key = case when p_status = 'active' and status = 'active' and v_plan_key is not null then v_plan_key else plan_key end
   where tenant_id = v_tenant_id;

  perform set_config('app.paddle_status', '', true);

  if p_status = 'canceled' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
    values (v_tenant_id, null, 'subscription.canceled', 'subscription', null, jsonb_build_object('provider', 'paddle'));
  end if;
  return 'applied';
end;
$$;
revoke all on function public.apply_paddle_subscription_event(text, timestamptz, text, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_paddle_subscription_event(text, timestamptz, text, text, text, text, timestamptz, text, jsonb) to service_role;

-- ── 6. Emails: the scheduled downgrade, and withdrawing it ───────────────
alter table public.subscription_emails drop constraint subscription_emails_kind_check;
alter table public.subscription_emails add constraint subscription_emails_kind_check
  check (kind in ('trial_started', 'payment_received', 'upgraded', 'downgraded', 'cancel_scheduled',
                  'renewal_resumed', 'canceled', 'paused', 'payment_failed', 'new_subscriber_admin',
                  'downgrade_scheduled', 'downgrade_canceled'));

create or replace function app.subscription_email_on_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'trialing' then
      perform app.queue_subscription_email(new.tenant_id, 'trial_started',
        jsonb_build_object('plan_key', new.plan_key, 'trial_ends_at', new.trial_ends_at));
    end if;
    return new;
  end if;

  -- A plan change of a paid, active subscription (a first payment from the trial is a payment email).
  if old.plan_key <> new.plan_key and old.status = 'active' and new.status = 'active' then
    perform app.queue_subscription_email(new.tenant_id,
      case when app.plan_change_direction(old.plan_key, new.plan_key) = 'downgrade' then 'downgraded' else 'upgraded' end,
      jsonb_build_object('from_plan', old.plan_key, 'plan_key', new.plan_key, 'current_period_end', new.current_period_end));
  end if;

  -- A downgrade scheduled for the next billing cycle, or withdrawn before it.
  if new.scheduled_plan_key is not null and new.scheduled_plan_key is distinct from old.scheduled_plan_key then
    perform app.queue_subscription_email(new.tenant_id, 'downgrade_scheduled',
      jsonb_build_object('from_plan', new.plan_key, 'plan_key', new.scheduled_plan_key, 'effective_at', new.scheduled_change_at));
  elsif old.scheduled_plan_key is not null and new.scheduled_plan_key is null
        and new.plan_key = old.plan_key and new.status <> 'canceled' then
    perform app.queue_subscription_email(new.tenant_id, 'downgrade_canceled',
      jsonb_build_object('plan_key', new.plan_key, 'was_scheduled', old.scheduled_plan_key, 'current_period_end', new.current_period_end));
  end if;

  if old.cancel_at is null and new.cancel_at is not null and new.status <> 'canceled' then
    perform app.queue_subscription_email(new.tenant_id, 'cancel_scheduled',
      jsonb_build_object('plan_key', new.plan_key, 'cancel_at', new.cancel_at));
  elsif old.cancel_at is not null and new.cancel_at is null and new.status = 'active' then
    perform app.queue_subscription_email(new.tenant_id, 'renewal_resumed',
      jsonb_build_object('plan_key', new.plan_key, 'current_period_end', new.current_period_end));
  end if;

  if old.status <> 'canceled' and new.status = 'canceled' then
    perform app.queue_subscription_email(new.tenant_id, 'canceled',
      jsonb_build_object('plan_key', new.plan_key, 'ended_at', coalesce(new.canceled_at, now())));
  elsif old.status <> 'past_due' and new.status = 'past_due' then
    -- Paddle "paused" and "past due" both stop the plan; apply_paddle_subscription_event says which.
    perform app.queue_subscription_email(new.tenant_id,
      case when current_setting('app.paddle_status', true) = 'paused' then 'paused' else 'payment_failed' end,
      jsonb_build_object('plan_key', new.plan_key, 'current_period_end', new.current_period_end));
  end if;
  return new;
end;
$$;

-- ── 7. The Super Admins' "subscription upgraded" alert: the same rule ────
create or replace function app.notify_subscription_upgraded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old public.subscription_plans%rowtype;
  v_new public.subscription_plans%rowtype;
  v_tenant public.tenants%rowtype;
begin
  begin
    if new.plan_key is not distinct from old.plan_key or new.status <> 'active' or app.is_super_admin() then
      return null;
    end if;
    select * into v_old from public.subscription_plans where key = old.plan_key;
    select * into v_new from public.subscription_plans where key = new.plan_key;
    if v_old.key is null or v_new.key is null then
      return null;
    end if;
    if app.plan_change_direction(v_old.key, v_new.key) <> 'upgrade' then
      return null;
    end if;
    select * into v_tenant from public.tenants where id = new.tenant_id;

    perform app.record_notification_event(
      'subscription_upgraded', 'platform', new.tenant_id, new.tenant_id,
      'subscription_upgraded:' || new.tenant_id || ':' || old.plan_key || '>' || new.plan_key || ':'
        || coalesce(new.current_period_end::text, now()::text),
      jsonb_build_object(
        'tenant_id', new.tenant_id,
        'slug', v_tenant.slug,
        'business_name', coalesce(v_tenant.business_name ->> 'en', (select value from jsonb_each_text(v_tenant.business_name) limit 1), v_tenant.slug),
        'from_plan_key', v_old.key,
        'from_plan_name', coalesce(v_old.name ->> 'en', v_old.key),
        'to_plan_key', v_new.key,
        'to_plan_name', coalesce(v_new.name ->> 'en', v_new.key),
        'upgraded_at', now()
      )
    );
  exception when others then
    -- Never let a notification problem undo the order, signup or payment.
    raise warning '%: notification skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;
