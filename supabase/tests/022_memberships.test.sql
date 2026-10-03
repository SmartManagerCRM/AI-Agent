-- pgTAP: memberships — plans, enrolment, payments, trial, member cap,
-- check-ins against visits per period, pause/resume, renewal, permissions,
-- tenant isolation, currency switch.
begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f0a1', 'mem-owner@test.local'),
  ('00000000-0000-4000-8000-00000000f0a2', 'mem-staff@test.local'),
  ('00000000-0000-4000-8000-00000000f0a3', 'mem-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-00000000f0b1', 'mem-a', '{"en":"Gym A"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-00000000f0b2', 'mem-b', '{"en":"Gym B"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000f0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000f0a2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b2', '00000000-0000-4000-8000-00000000f0a3', id from public.roles where key = 'business_owner' and tenant_id is null;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a1","role":"authenticated"}';
insert into public.membership_plans (id, tenant_id, name, kind, price_minor, joining_fee_minor, currency, billing_period, period_count, visits_per_period, grace_days, max_members) values
  ('00000000-0000-4000-8000-00000000f0c1', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Monthly gym"}', 'service', 5000, 2000, 'USD', 'month', 1, 2, 3, 2);
insert into public.membership_plans (id, tenant_id, name, kind, price_minor, currency, billing_period, auto_renew_default, discount_percent) values
  ('00000000-0000-4000-8000-00000000f0c2', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Coffee club"}', 'loyalty', 0, 'USD', 'none', false, 10);
insert into public.membership_plans (id, tenant_id, name, kind, price_minor, currency, billing_period, period_count, trial_days) values
  ('00000000-0000-4000-8000-00000000f0c3', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Yoga"}', 'service', 3000, 'USD', 'week', 4, 7);
select is((select count(*)::int from public.membership_plans where tenant_id = '00000000-0000-4000-8000-00000000f0b1'), 3, 'the owner creates plans');

create temp table r (k text primary key, v jsonb);
grant all on r to authenticated;
insert into r values ('m1', public.enrol_membership('00000000-0000-4000-8000-00000000f0c1', 'Ali', '+15550001', null, current_date, true, 'card', true, null));
select is((select v ->> 'ok' from r where k = 'm1'), 'true', 'a paid member is enrolled');
select is((select end_date from public.memberships where id = (select (v ->> 'membership_id')::uuid from r where k = 'm1')), (current_date + interval '1 month')::date,
  'the renewal date is one period after the start');
select is((select array_agg(kind || ':' || amount_minor order by kind) from public.membership_payments where membership_id = (select (v ->> 'membership_id')::uuid from r where k = 'm1')),
  array['joining:2000', 'period:5000'], 'the joining fee and the first period are recorded as payments');
insert into r values ('m2', public.enrol_membership('00000000-0000-4000-8000-00000000f0c1', 'Mona', '+15550002', null, current_date, false, null, true, null));
select is((select payment_status from public.memberships where id = (select (v ->> 'membership_id')::uuid from r where k = 'm2')), 'unpaid', 'an unpaid member is marked unpaid');
select is((select (v ->> 'member_number')::int from r where k = 'm2') - (select (v ->> 'member_number')::int from r where k = 'm1'), 1, 'member numbers count up');
select is(public.enrol_membership('00000000-0000-4000-8000-00000000f0c1', 'Third', null, null, current_date, true, 'cash', true, null) ->> 'reason', 'full',
  'the plan''s member cap is respected');

-- Free loyalty with no expiry; trial plan.
insert into r values ('m3', public.enrol_membership('00000000-0000-4000-8000-00000000f0c2', 'Sara', '+15550003', null, current_date, false, null, true, null));
select is((select payment_status || '/' || coalesce(end_date::text, 'none') || '/' || auto_renew from public.memberships where id = (select (v ->> 'membership_id')::uuid from r where k = 'm3')),
  'free/none/false', 'a free loyalty membership never expires and has nothing to renew');
insert into r values ('m4', public.enrol_membership('00000000-0000-4000-8000-00000000f0c3', 'Lina', null, null, current_date, false, null, true, null));
select is((select payment_status || '/' || (end_date - current_date) from public.memberships where id = (select (v ->> 'membership_id')::uuid from r where k = 'm4')),
  'trial/7', 'a trial runs for its trial days first');

-- Payment for an unpaid member.
select is(public.mark_membership_paid((select (v ->> 'membership_id')::uuid from r where k = 'm2'), 'cash') ->> 'ok', 'true', 'an unpaid member can be marked paid');
select is((select sum(amount_minor)::int from public.membership_payments where membership_id = (select (v ->> 'membership_id')::uuid from r where k = 'm2')), 7000,
  '… which records the joining fee and the period');

-- Check-ins against visits per period.
select is(public.membership_check_in((select (v ->> 'membership_id')::uuid from r where k = 'm1')) ->> 'ok', 'true', 'first visit');
select is(public.membership_check_in((select (v ->> 'membership_id')::uuid from r where k = 'm1')) ->> 'ok', 'true', 'second visit');
select is(public.membership_check_in((select (v ->> 'membership_id')::uuid from r where k = 'm1')) ->> 'reason', 'no_visits_left', 'the third is refused (2 per period)');

-- Pause and resume keep the paid days.
select is(public.set_membership_status((select (v ->> 'membership_id')::uuid from r where k = 'm1'), 'paused') ->> 'ok', 'true', 'a membership can be frozen');
select is(public.membership_check_in((select (v ->> 'membership_id')::uuid from r where k = 'm1')) ->> 'reason', 'paused', 'no check-in while frozen');
reset role;
update public.memberships set paused_on = current_date - 10 where id = (select (v ->> 'membership_id')::uuid from r where k = 'm1');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a1","role":"authenticated"}';
select is(public.set_membership_status((select (v ->> 'membership_id')::uuid from r where k = 'm1'), 'active') ->> 'ok', 'true', 'and resumed');
select is((select end_date from public.memberships where id = (select (v ->> 'membership_id')::uuid from r where k = 'm1')), (current_date + interval '1 month')::date + 10,
  'resuming adds the frozen days to the renewal date');

-- Renewal from the renewal date resets visits and records the payment.
select is(public.renew_membership((select (v ->> 'membership_id')::uuid from r where k = 'm1'), true, 'card') ->> 'ok', 'true', 'renewal');
select is((select visits_used || '/' || (end_date = ((current_date + interval '1 month')::date + 10 + interval '1 month')::date) from public.memberships
  where id = (select (v ->> 'membership_id')::uuid from r where k = 'm1')), '0/true', 'renewal extends from the renewal date and resets visits');
select is(public.renew_membership((select (v ->> 'membership_id')::uuid from r where k = 'm3'), true, 'card') ->> 'reason', 'no_expiry', 'a no-expiry plan cannot be renewed');

-- Direct edits are limited to contact details, auto-renew and notes.
select throws_ok($$ update public.memberships set end_date = current_date + 400 $$, '42501', null, 'renewal dates change only through renewal');

-- Staff: read, not write.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a2","role":"authenticated"}';
select ok((select count(*) from public.memberships) >= 4, 'staff can see the members');
select throws_ok($$ select public.membership_check_in((select (v ->> 'membership_id')::uuid from r where k = 'm2')) $$, '42501', null, 'staff cannot record changes');

-- Another business sees nothing and cannot act.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a3","role":"authenticated"}';
select is((select count(*)::int from public.memberships), 0, 'another business sees no members');
select throws_ok($$ select public.renew_membership((select (v ->> 'membership_id')::uuid from r where k = 'm2'), true, 'cash') $$, '42501', null,
  'another business cannot renew them');
reset role;

select * from finish();
rollback;
