-- Emails to the subscriber about their subscription, from support@smartmanager.me
-- (sent by the app through Resend — src/server/email/).
--
-- The database decides what happened, so no change is missed whoever made it
-- (Paddle's webhooks, the owner on the Billing page, the Super Admin): triggers
-- on `subscriptions` and `subscription_payments` queue one email per change in
-- `subscription_emails`; the app sends them in the background and marks each
-- one sent, retrying a failed send a few times.
--
--   trial_started       a business's free trial begins
--   payment_received    a payment succeeded (first payment, renewal, plan change)
--   upgraded            an active subscription moved to a higher-priced plan
--   downgraded          … to a lower-priced plan
--   cancel_scheduled    cancelled — stays active until the end of the paid period
--   renewal_resumed     a scheduled cancellation was withdrawn
--   canceled            the subscription has ended
--   paused              Paddle paused the subscription
--   payment_failed      a renewal payment failed (past due)

create table public.subscription_emails (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('trial_started', 'payment_received', 'upgraded', 'downgraded', 'cancel_scheduled',
                                     'renewal_resumed', 'canceled', 'paused', 'payment_failed')),
  -- What the email is about, as it was when it happened (amount, plans, dates).
  details jsonb not null default '{}'::jsonb,
  -- One email per payment, however often its row is touched.
  dedupe_key text unique,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index subscription_emails_due_idx on public.subscription_emails (next_attempt_at) where status in ('pending', 'sending');
create index subscription_emails_tenant_idx on public.subscription_emails (tenant_id, created_at desc);
alter table public.subscription_emails enable row level security;
alter table public.subscription_emails force row level security;
-- Read by the Super Admin only; written by the triggers and the app's service role.
create policy subscription_emails_select on public.subscription_emails for select using (app.is_super_admin());
revoke all on public.subscription_emails from anon, authenticated;
grant select on public.subscription_emails to authenticated;

create or replace function app.queue_subscription_email(p_tenant_id uuid, p_kind text, p_details jsonb, p_dedupe_key text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.subscription_emails (tenant_id, kind, details, dedupe_key)
  values (p_tenant_id, p_kind, coalesce(p_details, '{}'::jsonb), p_dedupe_key)
  on conflict (dedupe_key) do nothing;
$$;

-- A plan's price per month (a yearly plan's price / 12), to tell an upgrade from a downgrade.
create or replace function app.plan_monthly_price(p_plan_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case billing_interval when 'year' then price_minor / 12.0 else price_minor::numeric end
    from public.subscription_plans where key = p_plan_key;
$$;

create or replace function app.subscription_email_on_subscription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old numeric;
  v_new numeric;
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
    v_old := app.plan_monthly_price(old.plan_key);
    v_new := app.plan_monthly_price(new.plan_key);
    perform app.queue_subscription_email(new.tenant_id, case when v_new < v_old then 'downgraded' else 'upgraded' end,
      jsonb_build_object('from_plan', old.plan_key, 'plan_key', new.plan_key, 'current_period_end', new.current_period_end));
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

create trigger subscription_emails after insert or update on public.subscriptions
  for each row execute function app.subscription_email_on_subscription();

create or replace function app.subscription_email_on_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Real payments only (the built-in test checkout moves no money).
  if new.status = 'succeeded' and new.provider <> 'mock' and (tg_op = 'INSERT' or old.status <> 'succeeded') then
    perform app.queue_subscription_email(new.tenant_id, 'payment_received',
      jsonb_build_object('payment_id', new.id, 'plan_key', new.plan_key, 'amount_minor', new.amount_minor, 'currency', new.currency),
      'payment:' || new.id::text);
  end if;
  return new;
end;
$$;

create trigger subscription_payment_emails after insert or update of status on public.subscription_payments
  for each row execute function app.subscription_email_on_payment();

-- Tell the email trigger whether Paddle paused the subscription or a renewal failed.
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

-- ── The app's sender (service role) ──────────────────────────────────────
-- Takes up to p_limit due emails (each by one sender only), with what the
-- email needs: the subscriber, the plan(s) and the subscription now.
create or replace function public.claim_subscription_emails(p_limit integer default 20)
returns table(
  id bigint, kind text, details jsonb, attempts integer, created_at timestamptz,
  tenant_id uuid, tenant_slug text, business_name jsonb, default_language text, tenant_timezone text,
  owner_email text, owner_name text, owner_language text,
  subscription jsonb, plans jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  return query
  with due as (
    select e.id from public.subscription_emails e
     where e.status in ('pending', 'sending') and e.next_attempt_at <= now()
     order by e.id
     for update skip locked
     limit greatest(1, least(p_limit, 100))
  ), claimed as (
    update public.subscription_emails e
       set status = 'sending', attempts = e.attempts + 1, next_attempt_at = now() + interval '10 minutes'
      from due where e.id = due.id
    returning e.*
  )
  select c.id, c.kind, c.details, c.attempts, c.created_at,
         t.id, t.slug::text, t.business_name, t.default_language, t.timezone::text,
         coalesce(nullif(owner.email::text, ''), nullif(t.contact_email::text, '')), owner.full_name, owner.preferred_language,
         (select to_jsonb(s) - 'paddle_customer_id' - 'paddle_event_at' from public.subscriptions s where s.tenant_id = t.id),
         (select jsonb_object_agg(p.key, jsonb_build_object('name', p.name, 'price_minor', p.price_minor, 'currency', p.currency,
                   'billing_interval', p.billing_interval, 'exponent', (select cu.exponent from public.currencies cu where cu.code = p.currency)))
            from public.subscription_plans p)
    from claimed c
    join public.tenants t on t.id = c.tenant_id
    left join lateral (
      select pr.email, pr.full_name, pr.preferred_language
        from public.tenant_members tm
        join public.roles r on r.id = tm.role_id and r.key = 'business_owner'
        join public.profiles pr on pr.id = tm.user_id
       where tm.tenant_id = t.id and tm.status = 'active'
       order by tm.created_at
       limit 1
    ) owner on true;
end;
$$;

-- p_error null: sent. Otherwise retried later (p_retry_in_seconds), or given up (null).
create or replace function public.finish_subscription_email(p_id bigint, p_status text, p_error text default null, p_retry_in_seconds integer default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.subscription_emails
     set status = case when p_status = 'sent' then 'sent'
                       when p_status = 'skipped' then 'skipped'
                       when p_retry_in_seconds is not null then 'pending'
                       else 'failed' end,
         sent_at = case when p_status = 'sent' then now() else sent_at end,
         last_error = left(p_error, 500),
         next_attempt_at = case when p_retry_in_seconds is not null then now() + make_interval(secs => p_retry_in_seconds) else next_attempt_at end
   where id = p_id;
$$;

revoke all on function app.queue_subscription_email(uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_subscription_emails(integer) from public, anon, authenticated;
revoke all on function public.finish_subscription_email(bigint, text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_subscription_emails(integer) to service_role;
grant execute on function public.finish_subscription_email(bigint, text, text, integer) to service_role;
