-- pgTAP: edit / suspend / delete for what a business adds, and its kept words.
--   A  an order's customer details: its business only; a delivery order keeps an address
--   B  deleting an order: refused once paid; its lines and history go with it
--   C  removing a staff member: never the owner; never from another business
--   D  leads, coupons, bookings and members: deleted by their business only
--   E  customers can be suspended; kept words re-check the business's texts
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000e0aa1', 'edit-owner@test.local'),
  ('00000000-0000-4000-8000-0000000e0aa2', 'edit-staff@test.local'),
  ('00000000-0000-4000-8000-0000000e0aa3', 'edit-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000e0bb1', 'edit-a', '{"en":"Edit A"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000e0bb2', 'edit-b', '{"en":"Edit B"}', 'restaurant', 'active', 'USD', 'UTC');
insert into public.tenant_members (id, tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0cc1', '00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (id, tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0cc2', '00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0aa2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (id, tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000e0cc3', '00000000-0000-4000-8000-0000000e0bb2', '00000000-0000-4000-8000-0000000e0aa3', id from public.roles where key = 'business_owner' and tenant_id is null;

insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, currency, subtotal_minor, total_minor, customer_name, delivery_address) values
  ('00000000-0000-4000-8000-0000000e0d01', '00000000-0000-4000-8000-0000000e0bb1', 5001, 'pending_payment', 'delivery', 'USD', 1000, 1000, 'Lina', '{"formatted":"Old street 1"}'),
  ('00000000-0000-4000-8000-0000000e0d02', '00000000-0000-4000-8000-0000000e0bb1', 5002, 'paid', 'pickup', 'USD', 2000, 2000, 'Omar', null);
insert into public.payments (tenant_id, order_id, provider, status, amount_minor, currency) values
  ('00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0d02', 'cash_on_delivery', 'succeeded', 2000, 'USD'),
  ('00000000-0000-4000-8000-0000000e0bb1', '00000000-0000-4000-8000-0000000e0d01', 'cash_on_delivery', 'pending', 1000, 'USD');
insert into public.leads (id, tenant_id, message) values
  ('00000000-0000-4000-8000-0000000e0e01', '00000000-0000-4000-8000-0000000e0bb1', 'Call me back');
insert into public.coupons (id, tenant_id, code, discount_type, discount_value) values
  ('00000000-0000-4000-8000-0000000e0e02', '00000000-0000-4000-8000-0000000e0bb1', 'SAVE10', 'percentage', 1000);
insert into public.customers (id, tenant_id, name) values
  ('00000000-0000-4000-8000-0000000e0e03', '00000000-0000-4000-8000-0000000e0bb1', 'Regular');
insert into public.tenant_settings (tenant_id) values ('00000000-0000-4000-8000-0000000e0bb1') on conflict (tenant_id) do nothing;
insert into public.categories (id, tenant_id, name) values
  ('00000000-0000-4000-8000-0000000e0e04', '00000000-0000-4000-8000-0000000e0bb1', '{"en":"Drinks"}');
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated';
    execute 'grant execute on all functions in schema tap to authenticated';
  end if;
end $$;

-- ── A: order details ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa3","role":"authenticated"}';
select throws_ok($$ select public.update_order_details('00000000-0000-4000-8000-0000000e0d01', 'X', null, null, 'Somewhere', null) $$,
  '42501', null, 'another business cannot edit an order');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select throws_ok($$ select public.update_order_details('00000000-0000-4000-8000-0000000e0d01', 'Lina', null, null, '  ', null) $$,
  'P0001', 'VALIDATION_ERROR: a delivery order needs a delivery address', 'a delivery order keeps a delivery address');
select lives_ok($$ select public.update_order_details('00000000-0000-4000-8000-0000000e0d01', ' Lina K ', '+97450000001', 'lina@test.local', 'New street 2', 'Ring twice') $$,
  'the owner edits an order''s customer details');
reset role;
select is((select customer_name || '|' || customer_phone || '|' || (delivery_address ->> 'formatted') || '|' || notes from public.orders where id = '00000000-0000-4000-8000-0000000e0d01'),
  'Lina K|+97450000001|New street 2|Ring twice', '… saved, trimmed');
select is((select total_minor from public.orders where id = '00000000-0000-4000-8000-0000000e0d01'), 1000::bigint, '… and its total is untouched');
select is((select count(*)::int from public.audit_logs where action = 'order.details_updated' and entity_id = '00000000-0000-4000-8000-0000000e0d01'), 1, '… and audited');

-- ── B: deleting orders ──────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa3","role":"authenticated"}';
select throws_ok($$ select public.delete_order('00000000-0000-4000-8000-0000000e0d01') $$, '42501', null, 'another business cannot delete an order');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select throws_ok($$ select public.delete_order('00000000-0000-4000-8000-0000000e0d02') $$,
  'P0001', 'VALIDATION_ERROR: a paid order cannot be deleted', 'a paid order cannot be deleted');
select lives_ok($$ select public.delete_order('00000000-0000-4000-8000-0000000e0d01') $$, 'an unpaid order can be deleted');
reset role;
select is((select count(*)::int from public.orders where id = '00000000-0000-4000-8000-0000000e0d01'), 0, '… it is gone');
select is((select count(*)::int from public.payments where order_id = '00000000-0000-4000-8000-0000000e0d01'), 0, '… with its pending payment');
select is((select count(*)::int from public.orders where id = '00000000-0000-4000-8000-0000000e0d02'), 1, 'the paid order stays');

-- ── C: staff ────────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select throws_ok($$ select public.remove_staff_member('00000000-0000-4000-8000-0000000e0cc1') $$,
  'P0001', 'VALIDATION_ERROR: the business owner cannot be removed', 'the owner cannot be removed');
select throws_ok($$ select public.remove_staff_member('00000000-0000-4000-8000-0000000e0cc3') $$, '42501', null, 'nor a member of another business');
select lives_ok($$ select public.remove_staff_member('00000000-0000-4000-8000-0000000e0cc2') $$, 'the owner removes a staff member');
reset role;
select is((select count(*)::int from public.tenant_members where id = '00000000-0000-4000-8000-0000000e0cc2'), 0, '… who no longer belongs to the business');

-- ── D: deletes are kept to the business ─────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa3","role":"authenticated"}';
delete from public.leads where id = '00000000-0000-4000-8000-0000000e0e01';
delete from public.coupons where id = '00000000-0000-4000-8000-0000000e0e02';
update public.customers set is_active = false where id = '00000000-0000-4000-8000-0000000e0e03';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa1","role":"authenticated"}';
select is((select count(*)::int from public.leads) + (select count(*)::int from public.coupons), 2,
  'another business deleted nothing');
select is((select is_active from public.customers where id = '00000000-0000-4000-8000-0000000e0e03'), true, '… and suspended nothing');
delete from public.leads where id = '00000000-0000-4000-8000-0000000e0e01';
delete from public.coupons where id = '00000000-0000-4000-8000-0000000e0e02';
select is((select count(*)::int from public.leads) + (select count(*)::int from public.coupons), 0, 'the owner deletes a lead and a coupon');

-- ── E: suspend a customer; kept words ───────────────────────────────────
update public.customers set is_active = false where id = '00000000-0000-4000-8000-0000000e0e03';
select is((select is_active from public.customers where id = '00000000-0000-4000-8000-0000000e0e03'), false, 'the owner suspends a customer');
update public.tenant_settings set translation = '{"keep_words":["خيال = Khayal"]}' where tenant_id = '00000000-0000-4000-8000-0000000e0bb1';
select is((select translation -> 'keep_words' ->> 0 from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), 'خيال = Khayal',
  'the owner saves and reads the kept words');
select is(public.queue_tenant_translations('00000000-0000-4000-8000-0000000e0bb1'), 1, 'saving kept words re-checks the business''s texts');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000e0aa3","role":"authenticated"}';
select throws_ok($$ select public.queue_tenant_translations('00000000-0000-4000-8000-0000000e0bb1') $$, '42501', null, '… only for its own business');
update public.tenant_settings set translation = '{}' where tenant_id = '00000000-0000-4000-8000-0000000e0bb1';
reset role;
select is((select translation -> 'keep_words' ->> 0 from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-0000000e0bb1'), 'خيال = Khayal',
  'another business cannot change them');
reset role;

select * from finish();
rollback;
