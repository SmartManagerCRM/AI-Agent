-- pgTAP: plan changes — upgrades now, downgrades at the next billing cycle.
--   A  upgrade or downgrade: by tier (the family's monthly price); annual → monthly is always a downgrade
--   B  scheduling a downgrade: billing.write only, active paid period, a real downgrade, no cancellation pending
--   C  Paddle's events don't move the plan to the scheduled one before its date; the renewal payment does
--   D  withdrawing it; emails for scheduled / withdrawn / done; a cancelled subscription drops it
begin;
select plan(32);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000e0aa1', 'change-owner@test.local'),
  ('00000000-0000-4000-8000-0000000e0aa2', 'change-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000e0bb1', 'change-a', '{"en":"Change A"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000e0bb2', 'change-b', '{"en":"Change B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0bb2', '00000000-0000-4000-8000-0000000e0aa2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, is_active, sort_order, plan_family) values
  ('c33_starter', '{"en":"Starter"}', 7900, 'USD', 'month', true, 91, 'c33_starter'),
  ('c33_starter_y', '{"en":"Starter"}', 79000, 'USD', 'year', true, 91, 'c33_starter'),
  ('c33_growth', '{"en":"Growth"}', 14900, 'USD', 'month', true, 92, 'c33_growth'),
  ('c33_growth_y', '{"en":"Growth"}', 149000, 'USD', 'year', true, 92, 'c33_growth'),
  ('c33_pro', '{"en":"Pro"}', 24900, 'USD', 'month', true, 93, 'c33_pro'),
  ('c33_old', '{"en":"Old"}', 9900, 'USD', 'month', false, 99, null);
delete from public.subscriptions where tenant_id in ('00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0bb2');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end, paddle_subscription_id) values
  ('00000000-0000-4000-8000-0000000e0bb1', 'c33_pro', 'active', now() - interval '20 days', now() - interval '10 days', now() + interval '20 days', 'sub_c33'),
  ('00000000-0000-4000-8000-0000000e0bb2', 'c33_starter', 'trialing', now() + interval '3 days', null, null, null);
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role';
    execute 'grant execute on all functions in schema tap to authenticated, service_role';
  end if;
end $$;

-- ── A: direction ────────────────────────────────────────────────────────
select is(app.plan_change_direction('c33_starter', 'c33_growth'), 'upgrade', 'a higher tier is an upgrade');
select is(app.plan_change_direction('c33_pro', 'c33_growth'), 'downgrade', 'a lower tier is a downgrade');
select is(app.plan_change_direction('c33_growth', 'c33_growth_y'), 'upgrade', 'monthly → annual of the same tier is an upgrade (though cheaper per month)');
select is(app.plan_change_direction('c33_growth_y', 'c33_growth'), 'downgrade', 'annual → monthly of the same tier is a downgrade');
select is(app.plan_change_direction('c33_starter_y', 'c33_pro'), 'downgrade', 'annual → monthly is a downgrade even to a higher tier');
select is(app.plan_change_direction('c33_starter_y', 'c33_growth_y'), 'upgrade', 'annual → a higher annual tier is an upgrade');
select is(app.plan_change_direction('c33_pro', 'c33_starter_y'), 'downgrade', 'monthly → a lower annual tier is a downgrade');
select is(app.plan_change_direction('c33_growth', 'c33_growth'), 'same', 'the same plan');
select is(app.plan_change_direction('c33_starter', 'c33_old'), 'upgrade', 'a plan without a family: by its price per month');

-- A lower plan reported by Paddle mid-period (nothing scheduled here yet) waits too.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_paddle_subscription_event('evt_c33_0', now() - interval '1 minute', 'sub_c33', null, 'ctm_c33', 'active', null, 'c33_starter', '{}'), 'applied',
  'Paddle reports a lower plan before anything is scheduled here');
reset role;
select is((select plan_key from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), 'c33_pro',
  '… the plan stays until the end of the paid period');

-- ── B: scheduling ───────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa2","role":"authenticated"}';
select throws_ok($$ select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_growth') $$,
  '42501', null, 'another business''s owner cannot schedule a change');
select throws_ok($$ select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb2', 'c33_starter') $$,
  '22023', null, 'a free trial has no paid period to change at the end of');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select throws_ok($$ select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_pro') $$,
  '22023', null, 'the current plan is not a downgrade');
select throws_ok($$ select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_old') $$,
  '22023', null, 'an inactive plan is refused');
select is(public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_growth'),
  (select current_period_end from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'),
  'a downgrade takes effect at the end of the paid period');
select is((select scheduled_plan_key || '|' || plan_key || '|' || (scheduled_change_at = current_period_end)
  from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), 'c33_growth|c33_pro|true',
  'the owner sees the scheduled plan; the current plan stays');
select is((select scheduled_plan_key from public.paddle_billing_subscription('00000000-0000-4000-8000-0000000e0bb1')), 'c33_growth',
  'the billing view carries it');
reset role;
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000e0bb1' and kind = 'downgrade_scheduled'
  and details ->> 'plan_key' = 'c33_growth' and details ->> 'from_plan' = 'c33_pro'), 1, 'the subscriber is emailed the scheduled downgrade');

-- ── C: Paddle's events before the date, then the renewal ────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.apply_paddle_subscription_event('evt_c33_1', now(), 'sub_c33', null, 'ctm_c33', 'active', null, 'c33_growth', '{}'), 'applied',
  'Paddle reports the lower price set for the next renewal');
reset role;
select is((select plan_key || '|' || scheduled_plan_key from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'),
  'c33_pro|c33_growth', '… the plan stays until the end of the paid period');
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000e0bb1' and kind in ('downgraded', 'upgraded')), 0,
  '… and no plan-change email yet');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.record_paddle_payment('evt_c33_2', 'txn_c33_renew', 'sub_c33', 'ctm_c33', 'c33_growth', 14900, 'USD', null,
  now(), now() + interval '1 month', '{}'), 'recorded', 'the renewal at the new plan''s price is recorded');
reset role;
select is((select plan_key || '|' || coalesce(scheduled_plan_key, '-') || '|' || coalesce(scheduled_change_at::text, '-')
  from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), 'c33_growth|-|-',
  'the new billing cycle starts on the new plan; nothing is scheduled any more');
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000e0bb1' and kind = 'downgraded'), 1,
  'the downgrade email is sent once it applies');
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000e0bb1' and kind = 'downgrade_canceled'), 0,
  '… not a "withdrawn" one');

-- ── D: withdrawing; cancellation ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_starter');
select is(public.cancel_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1'), 'c33_starter', 'the owner withdraws a scheduled downgrade');
select is(public.cancel_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1'), null, '… once');
reset role;
select is((select plan_key || '|' || coalesce(scheduled_plan_key, '-') from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'),
  'c33_growth|-', 'the plan renews as it is');
select is((select count(*)::int from public.subscription_emails where tenant_id = '00000000-0000-4000-8000-0000000e0bb1' and kind = 'downgrade_canceled'
  and details ->> 'was_scheduled' = 'c33_starter'), 1, 'the subscriber is emailed that it was withdrawn');

-- A cancellation pending: no downgrade (renew first); the end of the subscription drops a scheduled one.
update public.subscriptions set cancel_at = current_period_end where tenant_id = '00000000-0000-4000-8000-0000000e0bb1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select throws_ok($$ select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_starter') $$,
  '22023', null, 'no downgrade while a cancellation is pending');
reset role;
update public.subscriptions set cancel_at = null where tenant_id = '00000000-0000-4000-8000-0000000e0bb1';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select public.schedule_plan_downgrade('00000000-0000-4000-8000-0000000e0bb1', 'c33_starter');
reset role;
update public.subscriptions set status = 'canceled', canceled_at = now() where tenant_id = '00000000-0000-4000-8000-0000000e0bb1';
select is((select coalesce(scheduled_plan_key, '-') from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), '-',
  'a cancelled subscription has nothing scheduled');

select * from finish();
rollback;
