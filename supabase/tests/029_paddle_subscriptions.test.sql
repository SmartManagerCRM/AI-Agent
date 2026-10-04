-- pgTAP: subscriptions paid through Paddle, renewing automatically.
--   A  starting a Paddle checkout replaces a pending one (the test provider is unchanged)
--   B  the first payment activates the plan for Paddle's billing period — only at the checkout's price
--   C  renewals and plan changes arrive as new transactions of the linked subscription
--   D  subscription events: scheduled cancellation, past due, back to active, cancelled; older events ignored
--   E  a new checkout replaces a cancelled subscription; only the service role records anything
begin;
select plan(28);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000a0aa1', 'paddle-owner@test.local'),
  ('00000000-0000-4000-8000-0000000a0aa2', 'paddle-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000a0bb1', 'paddle-a', '{"en":"Paddle A"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000a0bb2', 'paddle-b', '{"en":"Paddle B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000a0bb1', '00000000-0000-4000-8000-0000000a0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000a0bb2', '00000000-0000-4000-8000-0000000a0aa2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, is_active, sort_order) values
  ('pdl_basic', '{"en":"Basic"}', 7900, 'USD', 'month', true, 90),
  ('pdl_pro', '{"en":"Pro"}', 24900, 'USD', 'month', true, 91);
-- Each business starts on its trial.
delete from public.subscriptions where tenant_id in ('00000000-0000-4000-8000-0000000a0bb1', '00000000-0000-4000-8000-0000000a0bb2');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at) values
  ('00000000-0000-4000-8000-0000000a0bb1', 'pdl_basic', 'trialing', now() + interval '3 days'),
  ('00000000-0000-4000-8000-0000000a0bb2', 'pdl_basic', 'trialing', now() + interval '3 days');
create temp table r (k text primary key, v text);
grant all on r to authenticated, service_role;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role';
    execute 'grant execute on all functions in schema tap to authenticated, service_role';
  end if;
end $$;

-- ── A: starting checkouts ───────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0aa1","role":"authenticated"}';
insert into r select 'pay1', payment_id::text from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb1', 'pdl_basic', 'paddle');
insert into r select 'pay2', payment_id::text from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb1', 'pdl_basic', 'paddle');
select ok((select v from r where k = 'pay1') <> (select v from r where k = 'pay2'), 'each Paddle checkout gets its own payment');
select is((select status || '/' || failure_reason from public.subscription_payments where id = (select v from r where k = 'pay1')::uuid), 'failed/superseded',
  '… the earlier, unpaid one is replaced');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0aa2","role":"authenticated"}';
insert into r select 'mock1', payment_id::text from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb2', 'pdl_basic', 'mock');
insert into r select 'mock2', payment_id::text from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb2', 'pdl_basic', 'mock');
select is((select v from r where k = 'mock1'), (select v from r where k = 'mock2'), 'the test provider still reuses its pending payment');
select throws_ok($$ select public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb2', 'pdl_basic', 'stripe') $$,
  'P0001', null, 'an unknown provider is refused');
-- Only Paddle's verified webhooks (the service role) record payments.
select throws_ok($$ select public.record_paddle_payment('evt_x', 'txn_x', null, null, null, 1, 'USD', null, null, null, '{}') $$,
  '42501', null, 'a signed-in user cannot record a Paddle payment');
select throws_ok($$ select public.apply_paddle_subscription_event('evt_y', now(), 'sub_x', null, null, 'canceled', null, null, '{}') $$,
  '42501', null, '… nor change a Paddle subscription');
reset role;

-- ── B: the first payment ────────────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_subscription_payment_provider_intent((select v from r where k = 'pay2')::uuid, 'txn_first');
select is(public.record_paddle_payment('evt_mm', 'txn_first', 'sub_A', 'ctm_A', 'pdl_basic', 100, 'USD', 100,
  '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', '{}'), 'mismatch', 'a payment at another price than the checkout is refused');
select is((select status from public.subscription_payments where id = (select v from r where k = 'pay2')::uuid), 'pending', '… and records nothing');
select is(public.record_paddle_payment('evt_1', 'txn_first', 'sub_A', 'ctm_A', 'pdl_basic', 7900, 'usd', 7900,
  '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z', '{"event":"one"}'), 'recorded', 'the checkout''s payment is recorded');
select is(public.record_paddle_payment('evt_1', 'txn_first', 'sub_A', 'ctm_A', 'pdl_basic', 7900, 'USD', 7900,
  null, null, '{}'), 'duplicate', 'the same webhook twice is applied once');
reset role;
select is((select status from public.subscription_payments where id = (select v from r where k = 'pay2')::uuid), 'succeeded', 'the payment succeeded');
select is((select status || '|' || plan_key || '|' || current_period_end::date || '|' || paddle_subscription_id || '|' || paddle_customer_id
  from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'),
  'active|pdl_basic|2026-11-01|sub_A|ctm_A', 'the plan is active for Paddle''s billing period, linked to the Paddle subscription');

-- ── C: renewals and plan changes ────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_paddle_payment('evt_2', 'txn_renew', 'sub_A', 'ctm_A', 'pdl_basic', 7900, 'USD', null,
  '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z', '{}'), 'recorded', 'a renewal of the linked subscription is recorded');
select is(public.record_paddle_payment('evt_3', 'txn_unknown', 'sub_unknown', null, 'pdl_pro', 24900, 'USD', null,
  null, null, '{}'), 'unknown', 'a transaction of an unknown subscription is ignored');
select is(public.apply_paddle_subscription_event('evt_4', '2026-11-02T00:00:00Z', 'sub_A', null, 'ctm_A', 'active', null, 'pdl_pro', '{}'),
  'applied', 'a plan change Paddle applied …');
reset role;
select is((select count(*)::int from public.subscription_payments where tenant_id = '00000000-0000-4000-8000-0000000a0bb1' and provider_intent_id = 'txn_renew' and status = 'succeeded'),
  1, '… the renewal is a new succeeded payment');
select is((select plan_key || '|' || current_period_end::date from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'),
  'pdl_pro|2026-12-01', '… the period moves on, and the new plan applies');

-- ── D: cancellation, past due ───────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_paddle_subscription_event('evt_5', '2026-11-10T00:00:00Z', 'sub_A', null, null, 'active', '2026-12-01T00:00:00Z', null, '{}'),
  'applied', 'a cancellation at the period''s end …');
select is(public.apply_paddle_subscription_event('evt_6', '2026-11-09T00:00:00Z', 'sub_A', null, null, 'active', null, null, '{}'),
  'stale', 'an older event arriving later is ignored');
reset role;
select is((select status || '|' || cancel_at::date from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'),
  'active|2026-12-01', '… keeps the plan active until then');
update public.subscriptions set current_period_end = now() + interval '20 days' where tenant_id = '00000000-0000-4000-8000-0000000a0bb1';
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_7', '2026-11-11T00:00:00Z', 'sub_A', null, null, 'past_due', null, null, '{}');
reset role;
select is((select status from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'), 'past_due', 'a failed renewal makes it past due');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_8', '2026-11-12T00:00:00Z', 'sub_A', null, null, 'active', null, null, '{}');
reset role;
select is((select status from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'), 'active', '… and active again once Paddle collects it');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.apply_paddle_subscription_event('evt_9', '2026-12-01T00:00:00Z', 'sub_A', null, null, 'canceled', null, null, '{}');
reset role;
select is((select status || '|' || (canceled_at is not null) || '|' || (cancel_at is null) from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'),
  'canceled|true|true', 'a cancelled subscription ends the plan');

-- ── E: subscribing again replaces the cancelled subscription ────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000a0aa1","role":"authenticated"}';
insert into r select 'pay3', payment_id::text from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000a0bb1', 'pdl_pro', 'paddle');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.record_subscription_payment_provider_intent((select v from r where k = 'pay3')::uuid, 'txn_again');
select is(public.apply_paddle_subscription_event('evt_10', '2026-12-05T00:00:00Z', 'sub_B', 'txn_again', 'ctm_A', 'active', null, 'pdl_pro', '{}'),
  'applied', 'the new subscription is found through its checkout');
select is(public.record_paddle_payment('evt_11', 'txn_again', 'sub_B', 'ctm_A', 'pdl_pro', 24900, 'USD', 24900, now(), now() + interval '1 month', '{}'),
  'recorded', '… and its payment recorded');
select is(public.apply_paddle_subscription_event('evt_12', '2026-12-06T00:00:00Z', 'sub_A', null, null, 'canceled', null, null, '{}'),
  'unknown', 'events of the replaced subscription no longer apply');
reset role;
select is((select status || '|' || plan_key || '|' || paddle_subscription_id from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb1'),
  'active|pdl_pro|sub_B', 'the business is active again on the new subscription');
select is((select count(*)::int from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000a0bb2' and status = 'trialing'), 1,
  'another business is untouched');

select * from finish();
rollback;
