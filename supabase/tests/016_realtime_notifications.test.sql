-- pgTAP: real-time console notifications (notification_events).
--   A  new_order_received follows the order state machine, once per order
--   B  a notification failure never blocks an order
--   C  who can read which events (tenant isolation, platform = Super Admin)
--   D  new_subscriber on signup (create_business)
--   E  subscription_upgraded only for a verified payment to a higher plan
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000f1', 'notify-owner-a@test.local'),
  ('00000000-0000-4000-8000-0000000000f2', 'notify-owner-b@test.local'),
  ('00000000-0000-4000-8000-0000000000f3', 'notify-admin@test.local'),
  ('00000000-0000-4000-8000-0000000000f4', 'notify-signup@test.local');
insert into public.profiles (id, email) values ('00000000-0000-4000-8000-0000000000f4', 'notify-signup@test.local')
  on conflict (id) do nothing;
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000000f3');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000000e1', 'notify-a', '{"en":"Notify A"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000000e2', 'notify-b', '{"en":"Notify B"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000f1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000f2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at) values
  ('00000000-0000-4000-8000-0000000000e1', 'starter', 'trialing', now() + interval '10 days'),
  ('00000000-0000-4000-8000-0000000000e2', 'starter', 'trialing', now() + interval '10 days');

-- Deferred triggers fire at commit; the test runs in one transaction, so fire them as we go.
set constraints all immediate;
delete from public.notification_events where tenant_id in ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2');

create function pg_temp.order_(p_id uuid, p_tenant uuid, p_number int, p_status text) returns void language sql as $$
  insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, currency, subtotal_minor, total_minor)
  values (p_id, p_tenant, p_number, p_status, 'pickup', 'USD', 8700, 8700);
$$;
create function pg_temp.events(p_order uuid) returns int language sql as $$
  select count(*)::int from public.notification_events where entity_id = p_order and kind = 'new_order_received';
$$;

-- ── A. New order received ───────────────────────────────────────────────
select pg_temp.order_('00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-0000000000e1', 5001, 'confirmed');
select is(pg_temp.events('00000000-0000-4000-8000-00000000a001'), 1, 'cash/pay-on-table order placed as confirmed → one event');
select is((select payload ->> 'order_number' from public.notification_events where entity_id = '00000000-0000-4000-8000-00000000a001'),
  '5001', 'event carries the order number');
select is((select (payload ->> 'total_minor')::int from public.notification_events where entity_id = '00000000-0000-4000-8000-00000000a001'),
  8700, '… and the total');

select pg_temp.order_('00000000-0000-4000-8000-00000000a002', '00000000-0000-4000-8000-0000000000e1', 5002, 'pending_payment');
select is(pg_temp.events('00000000-0000-4000-8000-00000000a002'), 0, 'online order awaiting payment → no event');
update public.orders set status = 'paid' where id = '00000000-0000-4000-8000-00000000a002';
select is(pg_temp.events('00000000-0000-4000-8000-00000000a002'), 1, 'verified payment (pending_payment → paid) → one event');
update public.orders set status = 'confirmed' where id = '00000000-0000-4000-8000-00000000a002';
update public.orders set status = 'preparing' where id = '00000000-0000-4000-8000-00000000a002';
select is(pg_temp.events('00000000-0000-4000-8000-00000000a002'), 1, 'later status changes add no event');
update public.orders set status = 'paid', updated_at = now() where id = '00000000-0000-4000-8000-00000000a001';
select is(pg_temp.events('00000000-0000-4000-8000-00000000a001'), 1, 'a repeated write adds no event');

select pg_temp.order_('00000000-0000-4000-8000-00000000a003', '00000000-0000-4000-8000-0000000000e1', 5003, 'pending_payment');
update public.orders set status = 'cancelled' where id = '00000000-0000-4000-8000-00000000a003';
select is(pg_temp.events('00000000-0000-4000-8000-00000000a003'), 0, 'failed/abandoned payment, then cancelled → no event');
select pg_temp.order_('00000000-0000-4000-8000-00000000a004', '00000000-0000-4000-8000-0000000000e1', 5004, 'draft');
select is(pg_temp.events('00000000-0000-4000-8000-00000000a004'), 0, 'draft order → no event');

select app.record_notification_event('new_order_received', 'tenant', '00000000-0000-4000-8000-0000000000e1',
  '00000000-0000-4000-8000-00000000a001', 'new_order_received:00000000-0000-4000-8000-00000000a001', '{}');
select is(pg_temp.events('00000000-0000-4000-8000-00000000a001'), 1, 'the same order is never recorded twice (dedupe key)');

-- ── B. A notification failure never blocks an order ─────────────────────
alter table public.notification_events add constraint test_reject_all check (false) not valid;
select lives_ok($$ select pg_temp.order_('00000000-0000-4000-8000-00000000a005', '00000000-0000-4000-8000-0000000000e1', 5005, 'confirmed') $$,
  'order still saved when the event cannot be written');
select is((select status from public.orders where id = '00000000-0000-4000-8000-00000000a005'), 'confirmed', '… and it is there');
alter table public.notification_events drop constraint test_reject_all;

select pg_temp.order_('00000000-0000-4000-8000-00000000b001', '00000000-0000-4000-8000-0000000000e2', 6001, 'confirmed');

-- ── C. Who can read which events ────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where tenant_id = '00000000-0000-4000-8000-0000000000e1'), 2,
  'owner A sees their own new-order events');
select is((select count(*)::int from public.notification_events where tenant_id = '00000000-0000-4000-8000-0000000000e2'), 0,
  'owner A never sees business B''s orders');
select is((select count(*)::int from public.notification_events where audience = 'platform'), 0, 'owner A sees no platform events');
select throws_ok($$ insert into public.notification_events (kind, audience, tenant_id, entity_id, dedupe_key)
  values ('new_order_received', 'tenant', '00000000-0000-4000-8000-0000000000e1', gen_random_uuid(), 'forged') $$,
  '42501', null, 'nobody can write events through the API');
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.notification_events $$, '42501', null, 'anonymous visitors cannot read events');
reset role;

-- ── D. New subscriber ───────────────────────────────────────────────────
-- As in production, the event is written at commit, once the whole signup is saved.
set constraints all deferred;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f4","role":"authenticated"}';
select lives_ok($$ select public.create_business('{"en":"Roasters Notify"}', 'restaurant', 'roasters-notify', 'en', 'USD') $$,
  'a business signs up');
reset role;
set constraints all immediate;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f4","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where audience = 'platform'), 0,
  'the new subscriber cannot read the platform event about themselves');
reset role;
select is((select count(*)::int from public.notification_events n join public.tenants t on t.id = n.tenant_id
  where t.slug = 'roasters-notify' and n.kind = 'new_subscriber'), 1, 'signup → one new_subscriber event');
select is((select payload ->> 'business_name' || '|' || (payload ->> 'plan_key') || '|' || (payload ->> 'owner_email')
  from public.notification_events n join public.tenants t on t.id = n.tenant_id where t.slug = 'roasters-notify'),
  'Roasters Notify|starter|notify-signup@test.local', 'event carries business, plan and owner');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
select ok((select count(*) from public.notification_events where audience = 'platform') >= 1, 'Super Admin sees platform events');
reset role;

-- ── E. Subscription upgraded ────────────────────────────────────────────
create function pg_temp.upgrades() returns int language sql as $$
  select count(*)::int from public.notification_events
  where tenant_id = '00000000-0000-4000-8000-0000000000e1' and kind = 'subscription_upgraded';
$$;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
create temp table attempt as select payment_id from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000000e1', 'growth', 'mock');
reset role;
select is(pg_temp.upgrades(), 0, 'starting a checkout → no event');
select public.mark_subscription_payment_failed((select payment_id from attempt), 'evt-fail-1', '{}', 'declined');
select is(pg_temp.upgrades(), 0, 'failed payment → no event');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
create temp table attempt2 as select payment_id from public.create_subscription_payment_attempt('00000000-0000-4000-8000-0000000000e1', 'growth', 'mock');
reset role;
select public.mark_subscription_payment_succeeded((select payment_id from attempt2), 'evt-ok-1', '{}');
select is(pg_temp.upgrades(), 1, 'verified payment starter → growth → one upgrade event');
select is((select payload ->> 'from_plan_key' || '>' || (payload ->> 'to_plan_key') from public.notification_events
  where tenant_id = '00000000-0000-4000-8000-0000000000e1' and kind = 'subscription_upgraded'), 'starter>growth', 'event names both plans');
select public.mark_subscription_payment_succeeded((select payment_id from attempt2), 'evt-ok-1', '{}');
select is(pg_temp.upgrades(), 1, 'duplicate webhook → still one event');

-- Lower monthly price is a downgrade, whatever the catalogue order.
update public.subscriptions set plan_key = 'starter' where tenant_id = '00000000-0000-4000-8000-0000000000e1';
select is(pg_temp.upgrades(), 1, 'downgrade → no event');
update public.subscriptions set status = 'past_due', plan_key = 'growth' where tenant_id = '00000000-0000-4000-8000-0000000000e1';
select is(pg_temp.upgrades(), 1, 'plan change without an active (paid) subscription → no event');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000f3","role":"authenticated"}';
select public.admin_update_subscription('00000000-0000-4000-8000-0000000000e2', 'growth', 'active', now(), now(), now() + interval '1 month');
reset role;
select is((select count(*)::int from public.notification_events where tenant_id = '00000000-0000-4000-8000-0000000000e2'
  and kind = 'subscription_upgraded'), 0, 'a Super Admin''s own plan edit is not a subscriber upgrade');

select * from finish();
rollback;
