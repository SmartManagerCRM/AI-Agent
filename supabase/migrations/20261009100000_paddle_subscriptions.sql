-- Subscriptions paid through Paddle (Paddle Billing), renewing automatically.
--
--   * A subscriber picks a plan → a pending `subscription_payments` row
--     (provider 'paddle') and a Paddle transaction for that plan's price
--     (src/server/billing/paddle/). Paying it creates a Paddle subscription
--     that Paddle renews every month / year.
--   * Paddle's signed webhooks (verified in the app) are the only thing that
--     records a payment or changes a subscription here — through the two
--     service-role functions below, never from a browser.
--   * Each webhook event is applied once (payment_webhook_events), and an
--     older subscription event never overrides a newer one.

-- ── Payments: allow Paddle ───────────────────────────────────────────────
alter table public.subscription_payments drop constraint subscription_payments_provider_check;
alter table public.subscription_payments add constraint subscription_payments_provider_check check (provider in ('mock', 'paddle'));

-- ── Subscriptions: the Paddle subscription behind a tenant's plan ────────
alter table public.subscriptions
  add column paddle_subscription_id text unique,
  add column paddle_customer_id text,
  -- Set when the subscriber cancelled: the subscription stays active until then.
  add column cancel_at timestamptz,
  -- When the last applied Paddle subscription event happened (older ones are ignored).
  add column paddle_event_at timestamptz;

-- `subscriptions` is granted column by column: members can see whether the plan
-- renews through Paddle and when a cancellation takes effect (not Paddle's customer id).
grant select (paddle_subscription_id, cancel_at) on public.subscriptions to authenticated;

-- ── Starting a payment ───────────────────────────────────────────────────
-- Same as before for the test provider. For Paddle, every new attempt
-- replaces a still-pending one (its checkout is simply never used); a late
-- payment of a replaced checkout is still recorded (record_paddle_payment).
create or replace function public.create_subscription_payment_attempt(p_tenant_id uuid, p_plan_key text, p_provider text default 'mock')
returns table(payment_id uuid, provider text, plan_key text, amount_minor bigint, currency text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.subscription_plans%rowtype;
  v_existing public.subscription_payments%rowtype;
  v_payment_id uuid;
begin
  if not (app.has_permission(p_tenant_id, 'billing.write') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: billing.write required' using errcode = '42501';
  end if;
  if p_provider not in ('mock', 'paddle') then
    raise exception 'VALIDATION_ERROR: unknown payment provider %', p_provider;
  end if;

  select * into v_plan from public.subscription_plans where key = p_plan_key and is_active;
  if not found then
    raise exception 'VALIDATION_ERROR: unknown or inactive plan %', p_plan_key;
  end if;

  select * into v_existing from public.subscription_payments
    where tenant_id = p_tenant_id and status = 'pending'
    order by created_at desc limit 1;
  if found then
    if p_provider = 'mock' and v_existing.provider = 'mock' then
      return query select v_existing.id, v_existing.provider, v_existing.plan_key, v_existing.amount_minor, v_existing.currency::text, true;
      return;
    end if;
    update public.subscription_payments
       set status = 'failed', failure_reason = 'superseded'
     where id = v_existing.id;
  end if;

  insert into public.subscription_payments (tenant_id, plan_key, provider, amount_minor, currency, status)
  values (p_tenant_id, p_plan_key, p_provider, v_plan.price_minor, v_plan.currency, 'pending')
  returning id into v_payment_id;

  return query select v_payment_id, p_provider, p_plan_key, v_plan.price_minor, v_plan.currency::text, false;
end;
$$;

-- ── A completed Paddle transaction (first payment, renewal or plan change) ──
-- Returns 'recorded', 'duplicate' (event already applied), 'unknown' (no
-- subscriber matches — e.g. a transaction this app didn't create) or
-- 'mismatch' (refused: not the price the checkout was started for).
-- p_check_amount: for the subscriber's own checkout, the plan price Paddle
-- charged must equal the one recorded when the checkout started.
create or replace function public.record_paddle_payment(
  p_event_id text,
  p_transaction_id text,
  p_paddle_subscription_id text,
  p_paddle_customer_id text,
  p_plan_key text,
  p_amount_minor bigint,
  p_currency text,
  p_check_amount bigint,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_tenant_id uuid;
  v_plan_key text;
  v_interval text;
begin
  select * into v_payment from public.subscription_payments
   where provider = 'paddle' and provider_intent_id = p_transaction_id
   for update;
  if found then
    v_tenant_id := v_payment.tenant_id;
  elsif p_paddle_subscription_id is not null then
    select tenant_id into v_tenant_id from public.subscriptions where paddle_subscription_id = p_paddle_subscription_id;
  end if;
  if v_tenant_id is null then
    return 'unknown';
  end if;

  if v_payment.id is not null and p_check_amount is not null
     and (v_payment.amount_minor <> p_check_amount or v_payment.currency::text <> upper(p_currency)) then
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
    values (v_tenant_id, null, 'subscription.payment_mismatch', 'subscription_payment', v_payment.id,
            jsonb_build_object('provider', 'paddle', 'transaction', p_transaction_id, 'charged', p_check_amount, 'currency', p_currency));
    return 'mismatch';
  end if;

  begin
    insert into public.payment_webhook_events (provider, event_id, payload) values ('paddle', p_event_id, p_raw);
  exception when unique_violation then
    return 'duplicate';
  end;

  select * into v_sub from public.subscriptions where tenant_id = v_tenant_id for update;
  -- The plan: the one this checkout was for, else the one Paddle's price carries, else the current one.
  v_plan_key := coalesce(
    v_payment.plan_key,
    (select key from public.subscription_plans where key = p_plan_key),
    v_sub.plan_key
  );
  select billing_interval into v_interval from public.subscription_plans where key = v_plan_key;

  if v_payment.id is not null then
    update public.subscription_payments
       set status = 'succeeded', failure_reason = null, raw_verification = p_raw
     where id = v_payment.id;
  else
    insert into public.subscription_payments (tenant_id, plan_key, provider, provider_intent_id, status, amount_minor, currency, raw_verification)
    values (v_tenant_id, v_plan_key, 'paddle', p_transaction_id, 'succeeded', p_amount_minor, upper(p_currency), p_raw)
    on conflict (provider, provider_intent_id) where provider_intent_id is not null do nothing;
  end if;

  update public.subscriptions
     set plan_key = v_plan_key,
         status = 'active',
         current_period_start = coalesce(p_period_start, now()),
         current_period_end = coalesce(p_period_end, now() + case v_interval when 'year' then interval '1 year' else interval '1 month' end),
         paddle_subscription_id = coalesce(p_paddle_subscription_id, paddle_subscription_id),
         paddle_customer_id = coalesce(p_paddle_customer_id, paddle_customer_id),
         canceled_at = null,
         conversation_limit_reached_at = null,
         conversation_limit_grace_until = null
   where tenant_id = v_tenant_id;

  update public.tenants set status = 'active' where id = v_tenant_id and status = 'suspended';

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_tenant_id, null, 'subscription.payment_succeeded', 'subscription_payment', coalesce(v_payment.id, (
            select id from public.subscription_payments where provider = 'paddle' and provider_intent_id = p_transaction_id)),
          jsonb_build_object('provider', 'paddle', 'transaction', p_transaction_id, 'plan', v_plan_key));
  return 'recorded';
end;
$$;

-- ── A Paddle subscription changed (created, renewed, cancelled, past due…) ──
-- The tenant is the one already linked to this Paddle subscription, or —
-- for a just-created one — the one whose checkout transaction created it.
-- A payment (record_paddle_payment), not this, is what makes a plan active.
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

  if p_status = 'canceled' then
    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
    values (v_tenant_id, null, 'subscription.canceled', 'subscription', null, jsonb_build_object('provider', 'paddle'));
  end if;
  return 'applied';
end;
$$;

-- ── Managing it from the console (cancel, resume, change plan, billing portal) ──
-- The app calls Paddle with the platform's key, so who may do that is decided
-- here, against the signed-in member: billing.write for this business.
create or replace function public.paddle_billing_subscription(p_tenant_id uuid)
returns table(paddle_subscription_id text, paddle_customer_id text, status text, plan_key text, cancel_at timestamptz)
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
    select s.paddle_subscription_id, s.paddle_customer_id, s.status, s.plan_key, s.cancel_at
      from public.subscriptions s where s.tenant_id = p_tenant_id;
end;
$$;
revoke all on function public.paddle_billing_subscription(uuid) from public, anon;
grant execute on function public.paddle_billing_subscription(uuid) to authenticated;

revoke all on function public.record_paddle_payment(text, text, text, text, text, bigint, text, bigint, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.apply_paddle_subscription_event(text, timestamptz, text, text, text, text, timestamptz, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_paddle_payment(text, text, text, text, text, bigint, text, bigint, timestamptz, timestamptz, jsonb) to service_role;
grant execute on function public.apply_paddle_subscription_event(text, timestamptz, text, text, text, text, timestamptz, text, jsonb) to service_role;
