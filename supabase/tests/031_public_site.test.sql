-- pgTAP: the public website's plans, contact details and sign-up on a chosen plan.
--   A  visitors (anon) see active public plans and contact details only through the two functions
--   B  annual plans: 10 months' price, 12 months' conversations and AI cap, same family as the monthly plan
--   C  create_business on a chosen plan: its trial; name, country and phone recorded; hidden plans refused
--   D  the older call (no plan) still starts the default plan's trial
begin;
select plan(18);

insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, trial_days, is_active, is_public, sort_order, plan_family)
values ('site_hidden', '{"en":"Hidden"}', 100, 'USD', 'month', 3, true, false, 90, null),
       ('site_off', '{"en":"Off"}', 100, 'USD', 'month', 3, false, true, 91, null),
       ('site_shown', '{"en":"Shown"}', 5000, 'USD', 'month', 5, true, true, 92, null);
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000f0aa1', 'site-owner@test.local');
insert into public.profiles (id, email) values ('00000000-0000-4000-8000-0000000f0aa1', 'site-owner@test.local') on conflict (id) do nothing;
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to anon, authenticated';
    execute 'grant execute on all functions in schema tap to anon, authenticated';
  end if;
end $$;

-- ── A ───────────────────────────────────────────────────────────────────
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select ok((select count(*) from public.public_subscription_plans() where key = 'site_shown') = 1, 'a visitor sees an active public plan');
select ok((select count(*) from public.public_subscription_plans() where key in ('site_hidden', 'site_off')) = 0, '… but not a hidden or inactive one');
select ok((select count(*) from public.public_subscription_plans() where key = 'growth' and is_popular) = 1, 'Growth is marked most popular');
select is((select count(*)::int from public.subscription_plans), 0, 'a visitor reads nothing from the plans table itself');
select is((select company_name || ' | ' || contact_phone from public.public_site_info()), 'Millennium Leaders | +216 27 67 97 97', 'a visitor sees the company''s contact details');
select throws_ok($$ select maintenance_mode from public.platform_settings $$, '42501', null, '… but not the platform settings');
reset role;

-- ── B ───────────────────────────────────────────────────────────────────
select is((select a.price_minor from public.subscription_plans a where a.key = 'growth_annual'),
          (select m.price_minor * 10 from public.subscription_plans m where m.key = 'growth'), 'annual Growth costs 10 months of monthly Growth');
select is((select billing_interval || ' ' || plan_family from public.subscription_plans where key = 'starter_annual'), 'year starter', 'annual Starter is yearly, in the Starter family');
select is((select a.conversation_limit from public.subscription_plans a where a.key = 'pro_annual'),
          (select m.conversation_limit * 12 from public.subscription_plans m where m.key = 'pro'), 'annual Pro: 12 months of conversations');
select is((select limit_usd from public.ai_cost_limits where plan_key = 'starter_annual'),
          (select limit_usd * 12 from public.ai_cost_limits where plan_key = 'starter'), '… and 12 months of AI cost cap');
select ok((select features ->> 'en' from public.subscription_plans where key = 'pro') like '%Dedicated onboarding%', 'plans carry their feature list');

-- ── C ───────────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
create temp table made on commit drop as
  select public.create_business('{"en":"Site Café"}', 'restaurant', 'site-cafe', 'en', 'USD', 'site_shown', 'Tunisia', '+216 11 222 333', 'Sami Owner') as id;
reset role;
select is((select s.plan_key || ' ' || s.status from public.subscriptions s join made on made.id = s.tenant_id), 'site_shown trialing', 'the trial is on the plan chosen on the website');
select ok((select s.trial_ends_at between now() + interval '5 days' - interval '1 minute' and now() + interval '5 days' + interval '1 minute'
             from public.subscriptions s join made on made.id = s.tenant_id), '… for that plan''s own trial length');
select is((select country || ' ' || contact_phone from public.tenants t join made on made.id = t.id), 'Tunisia +216 11 222 333', 'country and phone recorded');
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000f0aa1'), 'Sami Owner', 'the owner''s name recorded');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select throws_ok($$ select public.create_business('{"en":"Site Two"}', 'restaurant', 'site-two', 'en', 'USD', 'site_hidden') $$,
  '22023', null, 'a plan the website doesn''t offer is refused');

-- ── D ───────────────────────────────────────────────────────────────────
create temp table made2 on commit drop as
  select public.create_business('{"en":"Site Three"}', 'restaurant', 'site-three', 'en', 'USD') as id;
reset role;
select is((select s.plan_key from public.subscriptions s join made2 on made2.id = s.tenant_id),
          (select key from public.subscription_plans where is_default and is_active limit 1), 'without a plan: the default plan''s trial, as before');
set local role anon;
select throws_ok($$ select public.create_business('{"en":"X"}', 'restaurant', 'site-x', 'en', 'USD') $$, '42501', null, 'a visitor cannot create a business');
reset role;

select * from finish();
rollback;
