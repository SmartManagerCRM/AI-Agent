-- pgTAP: the customer says how many people; services carry no people limit.
begin;
select plan(8);

insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000b40a1', 'ps-one', '{"en":"PS One"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.branches (id, tenant_id, name, is_default, opening_hours) values
  ('00000000-0000-4000-8000-0000000b40b1', '00000000-0000-4000-8000-0000000b40a1', '{"en":"Main"}', true,
   (select jsonb_object_agg(d, '[{"open":"00:00","close":"23:59"}]'::jsonb) from unnest(array['mon','tue','wed','thu','fri','sat','sun']) d));
-- A new service, as the console now creates it: no capacity given.
insert into public.bookable_services (id, tenant_id, name, duration_minutes, online_booking) values
  ('00000000-0000-4000-8000-0000000b40f1', '00000000-0000-4000-8000-0000000b40a1', '{"en":"Table"}', 60, true);
create temp table t0 as select date_trunc('hour', now()) + interval '2 days' as at;
grant select on t0 to service_role;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

select is((select capacity from public.bookable_services where id = '00000000-0000-4000-8000-0000000b40f1'), null,
  'a new service has no people limit');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.book_service_at('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  (select at from t0), null, 6, 'Group', '+97455000001', null, null, 'agent_form') ->> 'ok', 'true'::text,
  'a party of 6 books, as the customer chose');
select is((select party_size from public.bookings where customer_name = 'Group'), 6, '… and the booking is for 6 people');
select is(public.book_service_at('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  (select at from t0), null, 4, 'Second group', '+97455000002', null, null, 'agent_form') ->> 'ok', 'true'::text,
  'another party can book the same time (no people limit)');
select is(public.book_service_at('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  (select at from t0), null, 0, 'Nobody', '+97455000003', null, null, 'agent_form') ->> 'reason', 'party_size'::text,
  'zero people is refused');
select is(public.book_service_at('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  (select at from t0), null, 501, 'Crowd', '+97455000004', null, null, 'agent_form') ->> 'reason', 'party_size'::text,
  'more than 500 is refused');
select ok((select count(*) from public.service_slots('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  ((select at from t0) at time zone 'UTC')::date) where starts_at = (select at from t0)) = 1,
  'the time stays offered after bookings');
select is((select spots_left from public.service_slots('00000000-0000-4000-8000-0000000b40a1', '00000000-0000-4000-8000-0000000b40f1',
  ((select at from t0) at time zone 'UTC')::date) limit 1), null::integer, '… with no "places left" count');
reset role;

select * from finish();
rollback;
