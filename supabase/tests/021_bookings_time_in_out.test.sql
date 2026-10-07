-- pgTAP: bookings with time in / time out, optional duration, capacity,
-- opening hours in the business's own time zone, online booking switch.
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000e0a1', 'book-owner@test.local'),
  ('00000000-0000-4000-8000-00000000e0a2', 'book-staff@test.local'),
  ('00000000-0000-4000-8000-00000000e0a3', 'book-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-00000000e0b1', 'book-a', '{"en":"Book A"}', 'restaurant', 'active', 'USD', 'Asia/Riyadh'),
  ('00000000-0000-4000-8000-00000000e0b2', 'book-b', '{"en":"Book B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0a2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000e0b2', '00000000-0000-4000-8000-00000000e0a3', id from public.roles where key = 'business_owner' and tenant_id is null;
-- Open 09:00–17:00 every day, and Fridays 18:00–02:00 (past midnight).
insert into public.branches (tenant_id, is_default, opening_hours) values ('00000000-0000-4000-8000-00000000e0b1', true,
  '{"mon":[{"open":"09:00","close":"17:00"}],"tue":[{"open":"09:00","close":"17:00"}],"wed":[{"open":"09:00","close":"17:00"}],
    "thu":[{"open":"09:00","close":"17:00"}],"fri":[{"open":"18:00","close":"02:00"}],"sat":[{"open":"09:00","close":"17:00"}],
    "sun":[{"open":"09:00","close":"17:00"}]}');
insert into public.bookable_services (id, tenant_id, name, duration_minutes, customer_sets_end, capacity, online_booking) values
  ('00000000-0000-4000-8000-00000000e0f1', '00000000-0000-4000-8000-00000000e0b1', '{"en":"Haircut"}', 45, false, 1, true),
  ('00000000-0000-4000-8000-00000000e0f2', '00000000-0000-4000-8000-00000000e0b1', '{"en":"Court"}', null, true, 2, true),
  ('00000000-0000-4000-8000-00000000e0f3', '00000000-0000-4000-8000-00000000e0b1', '{"en":"Private room"}', 60, false, 1, false);

-- A time zone typed as an offset is read the right way round (UTC+1 = one hour ahead), never as an error.
update public.tenants set timezone = 'UTC+1' where id = '00000000-0000-4000-8000-00000000e0b2';
select is(app.tenant_time_zone('00000000-0000-4000-8000-00000000e0b2'), 'Etc/GMT-1', '"UTC+1" is read as one hour ahead of UTC');
update public.tenants set timezone = 'Not/AZone' where id = '00000000-0000-4000-8000-00000000e0b2';
select is(app.tenant_time_zone('00000000-0000-4000-8000-00000000e0b2'), 'UTC', 'an unknown zone falls back to UTC instead of failing');

-- A weekday (Mon–Thu) and the next Friday, a week or more ahead.
create temp table d as
  select (select g::date from generate_series(current_date + 7, current_date + 14, interval '1 day') g where extract(isodow from g) = 2 limit 1) as tue,
         (select g::date from generate_series(current_date + 7, current_date + 14, interval '1 day') g where extract(isodow from g) = 5 limit 1) as fri;
grant select on d to authenticated;
grant select on d to service_role, anon;
-- pgTAP's own functions, callable while acting as the Agent's role (local pgTAP lives in schema "tap").
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to service_role, anon';
    execute 'grant execute on all functions in schema tap to service_role, anon';
  end if;
end $$;

-- ── Service role (the Agent's own booking form) ─────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d), '10:00', null, null, 1,
  'Sara', '+966500000001', null, null, 'agent_form') ->> 'ok'), 'true', 'a fixed-length service books with just a time in');
select is((select to_char(starts_at at time zone 'UTC', 'HH24:MI') || '-' || to_char(ends_at at time zone 'UTC', 'HH24:MI') from public.bookings
  where service_id = '00000000-0000-4000-8000-00000000e0f1'), '07:00-07:45', '10:00 in Riyadh is 07:00 UTC; time out = time in + 45 minutes');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d), '10:30', null, null, 1,
  'Omar', '+966500000002', null, null, 'agent_form') ->> 'reason'), 'full', 'an overlapping booking is refused at capacity 1');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d), '10:45', '13:00', null, 1,
  'Omar', '+966500000002', null, null, 'agent_form') ->> 'ok'), 'true', 'right after it is free (a time out is ignored: the length is fixed)');
select is((select ends_at - starts_at from public.bookings where customer_name = 'Omar'), interval '45 minutes', '… and keeps the service''s own length');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d), '08:00', null, null, 1,
  'Early', '+966500000003', null, null, 'agent_form') ->> 'reason'), 'closed', 'before opening time is refused');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d), '16:30', null, null, 1,
  'Late', '+966500000003', null, null, 'agent_form') ->> 'reason'), 'closed', 'a booking that would end after closing is refused');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', current_date - 1, '10:00', null, null, 1,
  'Past', '+966500000003', null, null, 'agent_form') ->> 'reason'), 'past', 'a date in the past is refused');

-- Customer-chosen time out / duration, capacity 2.
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select tue from d), '11:00', '13:30', null, 1,
  'Team A', '+966500000004', null, null, 'agent_form') ->> 'ends_at')::timestamptz - (select ((select tue from d) + time '11:00') at time zone 'Asia/Riyadh'),
  interval '2 hours 30 minutes', 'the customer''s own time out is kept');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select tue from d), '12:00', null, 90, 1,
  'Team B', '+966500000005', null, null, 'agent_form') ->> 'ok'), 'true', 'a duration instead of a time out works, and capacity 2 allows a second');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select tue from d), '12:30', null, null, 1,
  'Team C', '+966500000006', null, null, 'agent_form') ->> 'reason'), 'full', 'a third at the same time is refused');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select tue from d), '15:00', null, null, 1,
  'Open', '+966500000007', null, null, 'agent_form') -> 'ends_at'), 'null'::jsonb, 'no duration and no time out: an open-ended booking');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select tue from d), '09:00', null, null, 3,
  'Group', '+966500000008', null, null, 'agent_form') ->> 'reason'), 'party_size', 'more people than the service holds is refused');
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f2', (select fri from d), '23:00', '01:30', null, 1,
  'Night', '+966500000009', null, null, 'agent_form') ->> 'ok'), 'true', 'a Friday window running past midnight takes a 23:00–01:30 booking');

-- Online booking switch.
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f3', (select tue from d), '10:00', null, null, 1,
  'Sara', '+966500000001', null, null, 'agent_form') ->> 'reason'), 'unavailable', 'a service not offered online cannot be booked from the Agent');

-- Free slots.
select is((select local_time from public.service_slots('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d)) limit 1),
  '09:00', 'slots start at opening time, in local time');
select ok(not exists (select 1 from public.service_slots('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', (select tue from d))
  where local_time in ('09:45', '10:30')), 'taken times are not offered');
reset role;

-- ── Console (signed-in members) ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a1","role":"authenticated"}';
select is((public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f3', (select tue from d), '10:00', null, null, 1,
  'Walk-in', '+966500000010', null, 'VIP', 'console') ->> 'ok'), 'true', 'the owner can book an offline-only service from the console');
select throws_ok($$ select public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f3', current_date + 8, '10:00', null, null, 1,
  'x', '1', null, null, 'agent_form') $$, '42501', null, 'a member cannot pretend to be the Agent');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a2","role":"authenticated"}';
select is(public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f3', current_date + 8, '12:00', null, null, 1,
  'x', '1', null, null, 'console') ->> 'reason', 'branch', 'staff who work at no branch cannot book (staff book for their own branches)');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000e0a3","role":"authenticated"}';
select throws_ok($$ select public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f3', current_date + 8, '12:00', null, null, 1,
  'x', '1', null, null, 'console') $$, '42501', null, 'another business cannot book here');
reset role;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$ select public.book_service('00000000-0000-4000-8000-00000000e0b1', '00000000-0000-4000-8000-00000000e0f1', current_date + 8, '10:00', null, null, 1,
  'x', '1', null, null, 'agent_form') $$, '42501', null, 'anonymous callers cannot book directly');
reset role;

select * from finish();
rollback;
