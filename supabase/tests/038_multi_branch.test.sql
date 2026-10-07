-- pgTAP: multi-branch businesses.
--   A  branch staff see only their branches' orders (and everything attached to them) and alerts
--   B  they handle only those orders; owners and admins handle all
--   C  manual orders and bookings are for a branch; staff only for theirs
--   D  bookings: the branch's capacity; the branch's alerts
--   E  staff invites carry branches; roles: staff have no Business Brain, admins manage staff
--   F  the Agent's branch choices: open now, delivering for delivery
begin;
select plan(34);

-- Business 1: two branches. Owner, admin, staff at Downtown (main), staff at Marina.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000b3801', 'mb-owner@test.local'),
  ('00000000-0000-4000-8000-0000000b3802', 'mb-admin@test.local'),
  ('00000000-0000-4000-8000-0000000b3803', 'mb-downtown@test.local'),
  ('00000000-0000-4000-8000-0000000b3804', 'mb-marina@test.local'),
  ('00000000-0000-4000-8000-0000000b3805', 'mb-new@test.local'),
  ('00000000-0000-4000-8000-0000000b3806', 'mb-other-owner@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000b38a1', 'mb-one', '{"en":"MB One"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000b38a2', 'mb-two', '{"en":"MB Two"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_settings (tenant_id, checkout) values
  ('00000000-0000-4000-8000-0000000b38a1', '{"tax_rate_bps": 0}'), ('00000000-0000-4000-8000-0000000b38a2', '{"tax_rate_bps": 0}')
  on conflict (tenant_id) do update set checkout = excluded.checkout;
insert into public.branches (id, tenant_id, name, is_default, opening_hours, offers_delivery) values
  ('00000000-0000-4000-8000-0000000b38b1', '00000000-0000-4000-8000-0000000b38a1', '{"en":"Downtown"}', true, '{}', true),
  ('00000000-0000-4000-8000-0000000b38b2', '00000000-0000-4000-8000-0000000b38a1', '{"en":"Marina"}', false, '{}', false),
  -- closed every day of the week
  ('00000000-0000-4000-8000-0000000b38b3', '00000000-0000-4000-8000-0000000b38a1', '{"en":"Night"}', false,
   '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}', true),
  ('00000000-0000-4000-8000-0000000b38b9', '00000000-0000-4000-8000-0000000b38a2', '{"en":"Elsewhere"}', true, '{}', true);
insert into public.tenant_members (id, tenant_id, user_id, role_id)
select v.id, v.t, v.u, r.id from (values
  ('00000000-0000-4000-8000-0000000b38c1'::uuid, '00000000-0000-4000-8000-0000000b38a1'::uuid, '00000000-0000-4000-8000-0000000b3801'::uuid, 'business_owner'),
  ('00000000-0000-4000-8000-0000000b38c2', '00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b3802', 'business_admin'),
  ('00000000-0000-4000-8000-0000000b38c3', '00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b3803', 'staff'),
  ('00000000-0000-4000-8000-0000000b38c4', '00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b3804', 'staff'),
  ('00000000-0000-4000-8000-0000000b38c6', '00000000-0000-4000-8000-0000000b38a2', '00000000-0000-4000-8000-0000000b3806', 'business_owner')
) v(id, t, u, k) join public.roles r on r.key = v.k and r.tenant_id is null;
insert into public.tenant_member_branches (tenant_id, member_id, branch_id) values
  ('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38c3', '00000000-0000-4000-8000-0000000b38b1'),
  ('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38c4', '00000000-0000-4000-8000-0000000b38b2');
insert into public.products (id, tenant_id, name, price_minor, status) values
  ('00000000-0000-4000-8000-0000000b38d1', '00000000-0000-4000-8000-0000000b38a1', '{"en":"Latte"}', 1500, 'active');
-- One order per branch, one with no branch (dine-in, no branch: counts as the main branch).
insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, branch_id, currency, subtotal_minor, total_minor) values
  ('00000000-0000-4000-8000-0000000b38e1', '00000000-0000-4000-8000-0000000b38a1', 9001, 'confirmed', 'pickup', '00000000-0000-4000-8000-0000000b38b1', 'USD', 1500, 1500),
  ('00000000-0000-4000-8000-0000000b38e2', '00000000-0000-4000-8000-0000000b38a1', 9002, 'confirmed', 'pickup', '00000000-0000-4000-8000-0000000b38b2', 'USD', 1500, 1500),
  ('00000000-0000-4000-8000-0000000b38e3', '00000000-0000-4000-8000-0000000b38a1', 9003, 'confirmed', 'dine_in', null, 'USD', 1500, 1500);
insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
select '00000000-0000-4000-8000-0000000b38a1', o, '00000000-0000-4000-8000-0000000b38d1', '{"en":"Latte"}', 1500, 1, 1500
  from unnest(array['00000000-0000-4000-8000-0000000b38e1', '00000000-0000-4000-8000-0000000b38e2', '00000000-0000-4000-8000-0000000b38e3']::uuid[]) o;
insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
select '00000000-0000-4000-8000-0000000b38a1', o, 'cash_on_delivery', 1500, 'USD', 'pending'
  from unnest(array['00000000-0000-4000-8000-0000000b38e1', '00000000-0000-4000-8000-0000000b38e2', '00000000-0000-4000-8000-0000000b38e3']::uuid[]) o;
set constraints all immediate;  -- the new-order alerts
insert into public.bookable_services (id, tenant_id, name, duration_minutes, capacity, online_booking, requires_approval) values
  ('00000000-0000-4000-8000-0000000b38f1', '00000000-0000-4000-8000-0000000b38a1', '{"en":"Table"}', 60, 1, true, true);
create temp table d as select (current_date + 5) as day;
grant select on d to authenticated, service_role;
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

-- ── A: what each person sees ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3803","role":"authenticated"}';
select is((select array_agg(order_number order by order_number) from public.orders), array[9001, 9003],
  'Downtown staff see Downtown''s orders (and those with no branch: the main branch''s)');
select is((select count(*)::int from public.order_items), 2, '… only their items');
select is((select count(*)::int from public.payments), 2, '… only their payments');
select is((select count(*)::int from public.notification_events where kind = 'new_order_received'), 2, '… only their new-order alerts');
select is(public.my_branch_ids('00000000-0000-4000-8000-0000000b38a1'), array['00000000-0000-4000-8000-0000000b38b1'::uuid], '… and know their branch');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3804","role":"authenticated"}';
select is((select array_agg(order_number order by order_number) from public.orders), array[9002], 'Marina staff see only Marina''s');
select is((select count(*)::int from public.notification_events where kind = 'new_order_received'), 1, '… and hear only Marina''s orders');
select is((select count(*)::int from public.order_items where order_id = '00000000-0000-4000-8000-0000000b38e1'), 0, '… never Downtown''s items, even asked by id');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3802","role":"authenticated"}';
select is((select count(*)::int from public.orders), 3, 'the admin sees every branch''s orders');
select is(public.my_branch_ids('00000000-0000-4000-8000-0000000b38a1'), null, '… (no branch limit)');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3801","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where kind = 'new_order_received'), 3, 'the owner hears every order');

-- ── B: handling orders ──────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3804","role":"authenticated"}';
select throws_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b38e1', 'preparing', null) $$,
  '42501', null, 'Marina staff cannot move a Downtown order');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b38e2', 'preparing', null) $$,
  '… but move their own');
select throws_ok($$ select public.delete_order('00000000-0000-4000-8000-0000000b38e1') $$, '42501', null, '… nor delete another branch''s order');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3802","role":"authenticated"}';
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b38e1', 'preparing', null) $$,
  'the admin moves any branch''s order');

-- ── C: manual orders and bookings for a branch ──────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3804","role":"authenticated"}';
select throws_ok($$ select * from public.create_manual_orders('00000000-0000-4000-8000-0000000b38a1',
  '[{"fulfillment_type":"pickup","branch_id":"00000000-0000-4000-8000-0000000b38b1","items":[{"product_id":"00000000-0000-4000-8000-0000000b38d1","quantity":1}]}]') $$,
  '42501', null, 'Marina staff cannot add an order for Downtown');
create temp table m1 as select * from public.create_manual_orders('00000000-0000-4000-8000-0000000b38a1',
  '[{"fulfillment_type":"pickup","items":[{"product_id":"00000000-0000-4000-8000-0000000b38d1","quantity":1}]}]');
select is((select o.branch_id from m1 join public.orders o on o.id = m1.order_id), '00000000-0000-4000-8000-0000000b38b2'::uuid,
  '… their orders go to their branch');
select throws_ok($$ select public.book_service_at('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38f1',
  ((select day from d) + time '12:00') at time zone 'UTC', null, 1, 'Walk-in', null, null, null, 'console', null, '00000000-0000-4000-8000-0000000b38b1') $$,
  '42501', null, '… nor a booking for Downtown');
select is((public.book_service_at('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38f1',
  ((select day from d) + time '12:00') at time zone 'UTC', null, 1, 'Walk-in', null, null, null, 'console') ->> 'branch_id')::uuid,
  '00000000-0000-4000-8000-0000000b38b2'::uuid, '… their bookings go to their branch');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3802","role":"authenticated"}';
create temp table m2 as select * from public.create_manual_orders('00000000-0000-4000-8000-0000000b38a1',
  '[{"fulfillment_type":"pickup","branch_id":"00000000-0000-4000-8000-0000000b38b1","items":[{"product_id":"00000000-0000-4000-8000-0000000b38d1","quantity":1}]}]');
select is((select o.branch_id from m2 join public.orders o on o.id = m2.order_id), '00000000-0000-4000-8000-0000000b38b1'::uuid,
  'the admin adds orders for any branch');
reset role;
select throws_ok($$ insert into public.orders (tenant_id, order_number, status, fulfillment_type, currency, subtotal_minor, total_minor)
  values ('00000000-0000-4000-8000-0000000b38a1', 9100, 'confirmed', 'delivery', 'USD', 1, 1) $$,
  '23514', null, 'a pickup or delivery order never goes without a branch when the business has branches');

-- ── D: bookings at a branch ─────────────────────────────────────────────
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is((public.book_service_at('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38f1',
  ((select day from d) + time '12:00') at time zone 'UTC', null, 1, 'Lina', null, null, null, 'agent_form', null, '00000000-0000-4000-8000-0000000b38b1') ->> 'status'),
  'pending', 'the same time at Downtown is still free: capacity is per branch');
select is((public.book_service_at('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38f1',
  ((select day from d) + time '12:00') at time zone 'UTC', null, 1, 'Omar', null, null, null, 'agent_form', null, '00000000-0000-4000-8000-0000000b38b2') ->> 'reason'),
  'full', '… while Marina''s is taken');
select is((public.book_service_at('00000000-0000-4000-8000-0000000b38a1', '00000000-0000-4000-8000-0000000b38f1',
  ((select day from d) + time '15:00') at time zone 'UTC', null, 1, 'Sami', null, null, null, 'agent_form') ->> 'reason'),
  'branch', 'an Agent booking names its branch when there are several');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3804","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where kind = 'booking_requested'), 0, 'Marina staff don''t get Downtown''s booking request');
select is((select count(*)::int from public.bookings), 1, '… and see only Marina''s bookings');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3803","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where kind = 'booking_requested'), 1, 'Downtown staff do');

-- ── E: invites and roles ────────────────────────────────────────────────
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3802","role":"authenticated"}';
select throws_ok($$ select * from public.create_staff_invite('00000000-0000-4000-8000-0000000b38a1', 'mb-new@test.local', 'staff') $$,
  'P0001', 'VALIDATION_ERROR: choose at least one branch for this staff member', 'a staff invite needs a branch (the admin can invite)');
select throws_ok($$ select * from public.create_staff_invite('00000000-0000-4000-8000-0000000b38a1', 'mb-new@test.local', 'staff', array['00000000-0000-4000-8000-0000000b38b9'::uuid]) $$,
  'P0001', 'VALIDATION_ERROR: a branch is not one of yours', '… one of this business''s');
create temp table inv as select * from public.create_staff_invite('00000000-0000-4000-8000-0000000b38a1', 'mb-new@test.local', 'staff',
  array['00000000-0000-4000-8000-0000000b38b1', '00000000-0000-4000-8000-0000000b38b2']::uuid[]);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3805","role":"authenticated"}';
select is(public.accept_staff_invite((select token from inv)), '00000000-0000-4000-8000-0000000b38a1'::uuid, 'the new staff member accepts the invite');
select is((select count(*)::int from public.orders), 5, 'whoever accepts works at the invite''s branches (Downtown and Marina: all 5 orders)');
reset role;
select ok(not app.has_permission('00000000-0000-4000-8000-0000000b38a1', 'brain.read'), 'staff can''t open the Business Brain');

-- ── F: the Agent's branch choices ───────────────────────────────────────
select is((select array_agg(name ->> 'en' order by is_default desc, name ->> 'en') from public.open_branches('00000000-0000-4000-8000-0000000b38a1', 'pickup')),
  array['Downtown', 'Marina'], 'pickup: the branches open now (hours not set count as open; a closed one is left out)');
select is((select array_agg(name ->> 'en') from public.open_branches('00000000-0000-4000-8000-0000000b38a1', 'delivery')),
  array['Downtown'], 'delivery: only the open branches that deliver');

select * from finish();
rollback;
