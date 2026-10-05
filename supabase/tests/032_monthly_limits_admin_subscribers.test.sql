-- pgTAP: annual plans count usage month by month; Super Admin alerts and subscription creation.
--   A  annual plan: the running month (from the subscription's day), monthly limits, AI spend per month
--   B  monthly plan unchanged (its billing period)
--   C  first real payment marked; later ones not
--   D  a business that signs up queues one email to the Super Admins; one a Super Admin creates does not
--   E  admin_create_subscriber: Super Admin only; trial or active on any active plan
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000d0aa1', 'annual-owner@test.local'),
  ('00000000-0000-4000-8000-0000000d0aa2', 'new-owner@test.local'),
  ('00000000-0000-4000-8000-0000000d0ad1', 'boss@test.local');
insert into public.profiles (id, full_name, email) values
  ('00000000-0000-4000-8000-0000000d0aa1', 'Annual Owner', 'annual-owner@test.local'),
  ('00000000-0000-4000-8000-0000000d0aa2', '', 'new-owner@test.local'),
  ('00000000-0000-4000-8000-0000000d0ad1', 'Boss', 'boss@test.local')
  on conflict (id) do update set email = excluded.email, full_name = excluded.full_name;
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000d0ad1') on conflict do nothing;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role';
    execute 'grant execute on all functions in schema tap to authenticated, service_role';
  end if;
end $$;

insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, conversation_limit, is_active, sort_order, plan_family) values
  ('t32_month', '{"en":"T32"}', 7900, 'USD', 'month', 1000, true, 90, 't32_month'),
  ('t32_year', '{"en":"T32 Annual"}', 79000, 'USD', 'year', 1000, true, 90, 't32_month');
insert into public.ai_cost_limits (plan_key, limit_usd) values ('t32_month', 20), ('t32_year', 20);

-- ── A: annual Starter-like plan from 25 January (now is 2026-10-05 in production tests; use a relative date) ──
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone, default_language) values
  ('00000000-0000-4000-8000-0000000d0bb1', 't32-annual', '{"en":"Annual Cafe"}', 'restaurant', 'active', 'USD', 'UTC', 'en'),
  ('00000000-0000-4000-8000-0000000d0bb2', 't32-monthly', '{"en":"Monthly Cafe"}', 'restaurant', 'active', 'USD', 'UTC', 'en');
-- Subscribed 2 months and 10 days ago, for a year.
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000d0bb1', 't32_year', 'active', now() - interval '3 months', now() - interval '2 months 10 days', now() - interval '2 months 10 days' + interval '1 year');
create temp table snap_a as select app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb1', false) as s;
select is((select (s ->> 'period_start')::timestamptz from snap_a), (select current_period_start + interval '2 months' from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000d0bb1'),
  'annual: usage is counted from the subscription day of this month');
select is((select (s ->> 'period_end')::timestamptz from snap_a), (select current_period_start + interval '3 months' from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000d0bb1'),
  '… until the same day next month');
select is((select (s ->> 'conversation_limit')::int from snap_a), 1000, 'annual: the monthly conversation limit (not 12×)');
select is((select (s ->> 'ai_cost_limit')::numeric from snap_a), 20::numeric, 'annual: the monthly AI cost cap (not 12×)');

-- Conversations and AI spend before this month don't count.
insert into public.conversations (tenant_id, session_token_hash, last_message_at) values
  ('00000000-0000-4000-8000-0000000d0bb1', 't32-a', now() - interval '1 month'),
  ('00000000-0000-4000-8000-0000000d0bb1', 't32-b', now() - interval '1 day');
insert into public.agent_interactions (tenant_id, request_type, handled_by, success, estimated_cost_usd, provider, model, created_at) values
  ('00000000-0000-4000-8000-0000000d0bb1', 'chat', 'ai', true, 15, 'gemini', 'test-model', now() - interval '1 month'),
  ('00000000-0000-4000-8000-0000000d0bb1', 'chat', 'ai', true, 2, 'gemini', 'test-model', now() - interval '1 day');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb1', false) ->> 'conversations_used')::int, 1, 'only this month''s conversations count');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb1', false) ->> 'ai_cost_used')::numeric, 2::numeric, 'only this month''s AI spend counts');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb1', false) ->> 'usage_state'), 'ACTIVE', 'last month''s $15 doesn''t use up this month''s $20');

-- Month-end anchor: 31 January → 28 February → 31 March (never drifts).
update public.subscriptions set current_period_start = date_trunc('day', now()) - interval '1 year' + interval '1 day',
  current_period_end = date_trunc('day', now()) + interval '1 day' where tenant_id = '00000000-0000-4000-8000-0000000d0bb1';
select ok((app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb1', false) ->> 'period_end')::timestamptz <= date_trunc('day', now()) + interval '1 day',
  'the last month of the year ends with the subscription');

-- ── B: monthly plan ─────────────────────────────────────────────────────
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000d0bb2', 't32_month', 'active', now() - interval '11 days', now() - interval '10 days', now() + interval '20 days');
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000d0bb2', false) ->> 'period_start')::timestamptz,
  (select current_period_start from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000d0bb2'), 'monthly: its billing period, as before');

-- ── C: the first real payment ───────────────────────────────────────────
insert into public.subscription_payments (tenant_id, plan_key, provider, status, amount_minor, currency) values
  ('00000000-0000-4000-8000-0000000d0bb2', 't32_month', 'mock', 'succeeded', 7900, 'USD');
insert into public.subscription_payments (tenant_id, plan_key, provider, status, amount_minor, currency) values
  ('00000000-0000-4000-8000-0000000d0bb2', 't32_month', 'paddle', 'succeeded', 7900, 'USD');
insert into public.subscription_payments (tenant_id, plan_key, provider, status, amount_minor, currency) values
  ('00000000-0000-4000-8000-0000000d0bb2', 't32_month', 'paddle', 'succeeded', 7900, 'USD');
select is((select string_agg(details ->> 'first_payment', ',' order by id) from public.subscription_emails
            where tenant_id = '00000000-0000-4000-8000-0000000d0bb2' and kind = 'payment_received'), 'true,false',
  'the first real payment is marked (a test payment doesn''t count); the next one is not');

-- ── D: Super Admin alert ────────────────────────────────────────────────
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000d0bb1' and kind = 'new_subscriber_admin'), 1,
  'a business that signed up: one email to the Super Admins');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select ok(exists (select 1 from public.super_admin_recipients() r where r.email = 'boss@test.local'), 'the Super Admins'' addresses (service role)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0aa1","role":"authenticated"}';
select throws_ok($$ select * from public.super_admin_recipients() $$, '42501', null, '… not readable by a subscriber');

-- ── E: admin_create_subscriber ──────────────────────────────────────────
select throws_ok($$ select public.admin_create_subscriber('00000000-0000-4000-8000-0000000d0aa2', '{"en":"Nope"}', 'restaurant', 't32-nope', 'en', 'USD', 't32_month', 'trialing') $$,
  '42501', null, 'a subscriber cannot create subscriptions');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0ad1","role":"authenticated"}';
select lives_ok($$ select public.admin_create_subscriber('00000000-0000-4000-8000-0000000d0aa2', '{"fr":"Salon Neuf"}', 'restaurant', 't32-new', 'fr', 'TND',
  't32_year', 'active', null, null, 'Tunisia', '+216 1', 'Nadia New') $$, 'a Super Admin creates an active annual subscription for an account');
reset role;
select is((select s.plan_key || '|' || s.status || '|' || (s.current_period_end = s.current_period_start + interval '1 year')::text || '|' || r.key
             from public.tenants t join public.subscriptions s on s.tenant_id = t.id
             join public.tenant_members m on m.tenant_id = t.id join public.roles r on r.id = m.role_id
            where t.slug = 't32-new'),
  't32_year|active|true|business_owner', '… on the plan, paid for a year, the account as the business owner');
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000d0aa2'), 'Nadia New', '… the owner''s name filled in');
select is((select count(*)::int from public.subscription_emails e join public.tenants t on t.id = e.tenant_id where t.slug = 't32-new' and e.kind = 'new_subscriber_admin'), 0,
  'a business the Super Admin created is not announced back to them');

select * from finish();
rollback;
