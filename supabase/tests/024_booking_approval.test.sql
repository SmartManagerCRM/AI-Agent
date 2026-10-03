-- pgTAP: bookings the business confirms itself ("I confirm each request").
--   A  an Agent booking for such a service is a pending request that holds its place
--   B  the request reaches the business's consoles (booking_requested event, RLS)
--   C  the owner confirms or declines it; only a pending request can be answered
--   D  services set to confirm automatically, and console bookings, are confirmed at once
begin;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000d0aa1', 'appr-owner@test.local'),
  ('00000000-0000-4000-8000-0000000d0aa2', 'appr-staff@test.local'),
  ('00000000-0000-4000-8000-0000000d0aa3', 'appr-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000d0bb1', 'appr-a', '{"en":"Appr A"}', 'restaurant', 'active', 'USD', 'Asia/Qatar'),
  ('00000000-0000-4000-8000-0000000d0bb2', 'appr-b', '{"en":"Appr B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0aa2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000d0bb2', '00000000-0000-4000-8000-0000000d0aa3', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.bookable_services (id, tenant_id, name, duration_minutes, capacity, online_booking, requires_approval) values
  ('00000000-0000-4000-8000-0000000d0f01', '00000000-0000-4000-8000-0000000d0bb1', '{"en":"Private dinner"}', 120, 1, true, true),
  ('00000000-0000-4000-8000-0000000d0f02', '00000000-0000-4000-8000-0000000d0bb1', '{"en":"Table"}', 60, 1, true, false);
create temp table d as select (current_date + 9) as day;
grant select on d to authenticated, service_role, anon;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to service_role, anon';
    execute 'grant execute on all functions in schema tap to service_role, anon';
  end if;
end $$;

-- ── A: a request from the Agent ─────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temp table r1 as select public.book_service('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f01', (select day from d), '19:00', null, null, 1,
  'Lina', '+97450000001', null, null, 'agent_form') as j;
grant select on r1 to authenticated;
select is((select j ->> 'status' from r1), 'pending', 'an Agent booking for a "confirm each request" service is a pending request');
select is((select status from public.bookings where id = (select (j ->> 'booking_id')::uuid from r1)), 'pending', '… stored as pending');
select is((public.book_service('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f01', (select day from d), '20:00', null, null, 1,
  'Omar', '+97450000002', null, null, 'agent_form') ->> 'reason'), 'full', 'the request holds its place: an overlapping booking is refused');
select ok(not exists (select 1 from public.service_slots('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f01', (select day from d))
  where local_time = '19:00'), '… and its time is not offered to others');

-- D: confirm-automatically services are confirmed at once, with no request alert.
create temp table r2 as select public.book_service('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f02', (select day from d), '12:00', null, null, 1,
  'Sami', '+97450000003', null, null, 'agent_form') as j;
select is((select j ->> 'status' from r2), 'confirmed', 'a "confirm automatically" service is confirmed at once');
reset role;

-- ── B: the request reaches the business ─────────────────────────────────
select is((select payload ->> 'local_time' from public.notification_events where kind = 'booking_requested'
  and entity_id = (select (j ->> 'booking_id')::uuid from r1)), '19:00', 'a booking_requested event is recorded, with the local time');
select is((select count(*)::int from public.notification_events where kind = 'booking_requested'
  and tenant_id = '00000000-0000-4000-8000-0000000d0bb1'), 1, '… only for requests (not for bookings confirmed at once)');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0aa2","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where kind = 'booking_requested'), 1, 'staff with bookings.read receive the request alert');
select throws_ok($$ select public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r1), 'confirm') $$,
  '42501', null, '… but staff without bookings.write cannot answer it');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0aa3","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where kind = 'booking_requested'), 0, 'another business never sees the request');
select throws_ok($$ select public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r1), 'confirm') $$,
  '42501', null, '… nor answers it');

-- ── C: the owner answers ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0aa1","role":"authenticated"}';
select is((public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r1), 'decline') ->> 'status'), 'declined',
  'the owner declines a request');
select is((public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r1), 'confirm') ->> 'reason'), 'already_answered',
  'an answered request can''t be answered again');
select is((select decided_by from public.bookings where id = (select (j ->> 'booking_id')::uuid from r1)), '00000000-0000-4000-8000-0000000d0aa1'::uuid,
  'who answered, and when, is recorded');
-- D: console bookings are confirmed at once, even for this service.
select is((public.book_service('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f01', (select day from d), '13:00', null, null, 1,
  'Walk-in', '+97450000004', null, null, 'console') ->> 'status'), 'confirmed', 'a booking the owner makes in the console is confirmed at once');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
create temp table r3 as select public.book_service('00000000-0000-4000-8000-0000000d0bb1', '00000000-0000-4000-8000-0000000d0f01', (select day from d), '19:00', null, null, 1,
  'Huda', '+97450000005', null, null, 'agent_form') as j;
grant select on r3 to authenticated;
select is((select j ->> 'status' from r3), 'pending', 'a declined request frees its place for the next request');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000d0aa1","role":"authenticated"}';
select is((public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r3), 'confirm') ->> 'status'), 'confirmed',
  'the owner confirms a request');
select is((public.decide_booking('00000000-0000-4000-8000-0000000d0bb1', (select (j ->> 'booking_id')::uuid from r3), 'maybe') ->> 'reason'), 'invalid',
  'only confirm or decline');
reset role;
select is((select status from public.bookings where id = (select (j ->> 'booking_id')::uuid from r3)), 'confirmed', '… and it is confirmed');

select * from finish();
rollback;
