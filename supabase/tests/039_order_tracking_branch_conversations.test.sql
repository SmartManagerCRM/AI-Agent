-- pgTAP: order tracking, branch conversations, bookings at any branch.
--   A  an order's journey by type: collected (pickup), served (dine-in), out for delivery → delivered
--   B  order_tracking(): the order's own progress, service role only, never a draft
--   C  conversations belong to the branch ordered or booked at; staff see their branches'; customers are shared
--   D  bookings: every active branch is offered (open now or not); pickup still only open ones
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000b3901', 'ot-owner@test.local'),
  ('00000000-0000-4000-8000-0000000b3903', 'ot-downtown@test.local'),
  ('00000000-0000-4000-8000-0000000b3904', 'ot-marina@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000b39a1', 'ot-one', '{"en":"OT One"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.branches (id, tenant_id, name, is_default, opening_hours, offers_delivery) values
  ('00000000-0000-4000-8000-0000000b39b1', '00000000-0000-4000-8000-0000000b39a1', '{"en":"Downtown"}', true, '{}', true),
  ('00000000-0000-4000-8000-0000000b39b2', '00000000-0000-4000-8000-0000000b39a1', '{"en":"Marina"}', false, '{}', false),
  -- closed every day of the week
  ('00000000-0000-4000-8000-0000000b39b3', '00000000-0000-4000-8000-0000000b39a1', '{"en":"Night"}', false,
   '{"mon":[],"tue":[],"wed":[],"thu":[],"fri":[],"sat":[],"sun":[]}', true);
insert into public.tenant_members (id, tenant_id, user_id, role_id)
select v.id, v.t, v.u, r.id from (values
  ('00000000-0000-4000-8000-0000000b39c1'::uuid, '00000000-0000-4000-8000-0000000b39a1'::uuid, '00000000-0000-4000-8000-0000000b3901'::uuid, 'business_owner'),
  ('00000000-0000-4000-8000-0000000b39c3', '00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b3903', 'staff'),
  ('00000000-0000-4000-8000-0000000b39c4', '00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b3904', 'staff')
) v(id, t, u, k) join public.roles r on r.key = v.k and r.tenant_id is null;
insert into public.tenant_member_branches (tenant_id, member_id, branch_id) values
  ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39c3', '00000000-0000-4000-8000-0000000b39b1'),
  ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39c4', '00000000-0000-4000-8000-0000000b39b2');
insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, branch_id, currency, subtotal_minor, total_minor) values
  ('00000000-0000-4000-8000-0000000b39e1', '00000000-0000-4000-8000-0000000b39a1', 9201, 'confirmed', 'pickup', '00000000-0000-4000-8000-0000000b39b1', 'USD', 1500, 1500),
  ('00000000-0000-4000-8000-0000000b39e2', '00000000-0000-4000-8000-0000000b39a1', 9202, 'ready', 'dine_in', '00000000-0000-4000-8000-0000000b39b1', 'USD', 1500, 1500),
  ('00000000-0000-4000-8000-0000000b39e3', '00000000-0000-4000-8000-0000000b39a1', 9203, 'ready', 'delivery', '00000000-0000-4000-8000-0000000b39b1', 'USD', 1500, 1500),
  ('00000000-0000-4000-8000-0000000b39e4', '00000000-0000-4000-8000-0000000b39a1', 9204, 'draft', 'pickup', '00000000-0000-4000-8000-0000000b39b1', 'USD', 1500, 1500);
insert into public.order_items (tenant_id, order_id, product_name, unit_price_minor, quantity, total_minor) values
  ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39e1', '{"en":"Latte"}', 750, 2, 1500);
insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status) values
  ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39e1', 'cash_on_delivery', 1500, 'USD', 'pending');
-- Two conversations: one orders at Marina, one books at Downtown; a third has chosen nothing yet.
insert into public.conversations (id, tenant_id, session_token_hash) values
  ('00000000-0000-4000-8000-0000000b39d1', '00000000-0000-4000-8000-0000000b39a1', 'ot-h1'),
  ('00000000-0000-4000-8000-0000000b39d2', '00000000-0000-4000-8000-0000000b39a1', 'ot-h2'),
  ('00000000-0000-4000-8000-0000000b39d3', '00000000-0000-4000-8000-0000000b39a1', 'ot-h3');
insert into public.conversation_messages (tenant_id, conversation_id, role, content)
select '00000000-0000-4000-8000-0000000b39a1', c, 'user', 'hello'
  from unnest(array['00000000-0000-4000-8000-0000000b39d1', '00000000-0000-4000-8000-0000000b39d2', '00000000-0000-4000-8000-0000000b39d3']::uuid[]) c;
insert into public.carts (tenant_id, conversation_id) values ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39d1');
update public.carts set branch_id = '00000000-0000-4000-8000-0000000b39b2' where conversation_id = '00000000-0000-4000-8000-0000000b39d1';
insert into public.bookable_services (id, tenant_id, name, duration_minutes, capacity, online_booking) values
  ('00000000-0000-4000-8000-0000000b39f1', '00000000-0000-4000-8000-0000000b39a1', '{"en":"Table"}', 60, 1, true);
insert into public.bookings (tenant_id, service_id, branch_id, conversation_id, starts_at, ends_at, party_size, customer_name, status, source)
values ('00000000-0000-4000-8000-0000000b39a1', '00000000-0000-4000-8000-0000000b39f1', '00000000-0000-4000-8000-0000000b39b1',
  '00000000-0000-4000-8000-0000000b39d2', now() + interval '2 days', now() + interval '2 days 1 hour', 1, 'Rania', 'confirmed', 'agent_chat');
insert into public.customers (tenant_id, name) values
  ('00000000-0000-4000-8000-0000000b39a1', 'Shared Customer');
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

-- ── A: the journey by order type ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3903","role":"authenticated"}';
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'preparing', null) $$, 'pickup: confirmed → preparing');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'prepared', null) $$, '… → prepared');
select throws_like($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'collected', null) $$,
  '%cannot move to collected%', '… not collected before it is ready');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'ready', null) $$, '… → ready');
select throws_like($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'out_for_delivery', null) $$,
  '%cannot move to out_for_delivery%', '… a pickup order is never out for delivery');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e1', 'collected', null) $$, '… → collected');
select throws_like($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e2', 'collected', null) $$,
  '%cannot move to collected%', 'dine-in: not collected …');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e2', 'served', null) $$, '… but served');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e3', 'out_for_delivery', null) $$, 'delivery: ready → out for delivery');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e3', 'delivered', null) $$, '… → delivered');
select lives_ok($$ select public.update_order_status('00000000-0000-4000-8000-0000000b39e3', 'completed', null) $$, '… → completed');

-- ── B: the tracking page's data ─────────────────────────────────────────
select throws_ok($$ select public.order_tracking('00000000-0000-4000-8000-0000000b39e1') $$, '42501', null,
  'signed-in members cannot call order_tracking (the page reads it server-side)');
reset role;
set local role service_role;
select is(public.order_tracking('00000000-0000-4000-8000-0000000b39e1') ->> 'status', 'collected', 'the order''s current status');
select is((select array_agg(h ->> 'status') from jsonb_array_elements(public.order_tracking('00000000-0000-4000-8000-0000000b39e1') -> 'history') h),
  array['preparing', 'prepared', 'ready', 'collected'], '… each step it went through, in order');
select is(public.order_tracking('00000000-0000-4000-8000-0000000b39e1') -> 'branch_name' ->> 'en', 'Downtown', '… its branch');
select is(public.order_tracking('00000000-0000-4000-8000-0000000b39e1') ->> 'payment_status', 'pending', '… whether it is paid yet');
select is(public.order_tracking('00000000-0000-4000-8000-0000000b39e1') -> 'items' -> 0 ->> 'quantity', '2', '… and its items');
select is(public.order_tracking('00000000-0000-4000-8000-0000000b39e4'), null, 'a draft is never shown');
reset role;

-- ── C: conversations belong to a branch ─────────────────────────────────
select is((select branch_id from public.conversations where id = '00000000-0000-4000-8000-0000000b39d1'),
  '00000000-0000-4000-8000-0000000b39b2'::uuid, 'ordering at a branch makes it the conversation''s branch');
select is((select branch_id from public.conversations where id = '00000000-0000-4000-8000-0000000b39d2'),
  '00000000-0000-4000-8000-0000000b39b1'::uuid, '… and so does booking at one');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3904","role":"authenticated"}';
select is((select array_agg(id order by id) from public.conversations), array['00000000-0000-4000-8000-0000000b39d1'::uuid],
  'Marina staff see only Marina''s conversations');
select is((select count(*)::int from public.conversation_messages where conversation_id = '00000000-0000-4000-8000-0000000b39d2'), 0,
  '… never another branch''s messages, even asked by id');
select is((select count(*)::int from public.customers), 1, '… while customers stay shared by every branch');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3903","role":"authenticated"}';
select is((select array_agg(id order by id) from public.conversations),
  array['00000000-0000-4000-8000-0000000b39d2'::uuid, '00000000-0000-4000-8000-0000000b39d3'::uuid],
  'Downtown (main) staff see Downtown''s, and those with no branch yet');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000b3901","role":"authenticated"}';
select is((select count(*)::int from public.conversations), 3, 'the owner sees every conversation');
reset role;

-- ── D: bookings at any active branch ────────────────────────────────────
select is((select count(*)::int from public.open_branches('00000000-0000-4000-8000-0000000b39a1', 'booking')
  where id = '00000000-0000-4000-8000-0000000b39b3'), 1, 'a branch closed right now is still offered for bookings (its hours decide the times)');
select is((select count(*)::int from public.open_branches('00000000-0000-4000-8000-0000000b39a1', 'pickup')
  where id = '00000000-0000-4000-8000-0000000b39b3'), 0, '… but not for pickup while it is closed');

select * from finish();
rollback;
