-- pgTAP: Phase 5 structural checks (spec §13, §15, §16).
begin;
select plan(10);

select has_table('public', 'carts', 'carts table exists');
select has_table('public', 'cart_items', 'cart_items table exists');
select has_table('public', 'orders', 'orders table exists');
select has_table('public', 'order_items', 'order_items table exists');
select has_table('public', 'order_status_history', 'order_status_history table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.orders'::regclass),
  'RLS is enabled and forced on orders'
);

-- No direct write policy anywhere on orders — every write is
-- create_order_from_cart / update_order_status.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'orders' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'orders has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public' and routine_name in ('create_order_from_cart', 'update_order_status')),
  2,
  'both order-writing functions exist'
);

-- The order_number uniqueness guarantee the whole numbering scheme relies on.
select col_is_unique('public', 'orders', array['tenant_id', 'order_number'], 'order numbers are unique per tenant');

select has_column('public', 'tenant_settings', 'checkout', 'tenant_settings.checkout exists');

select * from finish();
rollback;
