-- pgTAP: real payment providers (Moyasar, Tap) + Cash on Delivery / Pay on
-- Table structural checks.
begin;
select plan(10);

-- tenant_payment_config exists, RLS enabled+forced, gated by settings.write
-- for BOTH select and update (stricter than tenant_settings, which allows
-- plain staff to select via settings.read) — the whole reason this is a
-- separate table rather than a new tenant_settings column.
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class
   where relnamespace = 'public'::regnamespace and relname = 'tenant_payment_config'),
  'tenant_payment_config has RLS enabled and forced'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'tenant_payment_config' and cmd = 'SELECT'
     and qual like '%settings.write%'),
  1,
  'tenant_payment_config select is gated by settings.write, not settings.read'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'tenant_payment_config' and cmd = 'UPDATE'
     and qual like '%settings.write%'),
  1,
  'tenant_payment_config update is gated by settings.write'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'tenant_payment_config' and cmd in ('INSERT', 'DELETE')),
  0,
  'tenant_payment_config has no client insert/delete policy — seeded only by create_business'
);

-- payments.provider now spans real gateways and the two in-person methods.
select ok(
  (select pg_get_constraintdef(oid) like '%moyasar%' and pg_get_constraintdef(oid) like '%tap%'
     and pg_get_constraintdef(oid) like '%cash_on_delivery%' and pg_get_constraintdef(oid) like '%pay_on_table%'
   from pg_constraint where conrelid = 'public.payments'::regclass and conname = 'payments_provider_check'),
  'payments.provider allows moyasar/tap/cash_on_delivery/pay_on_table alongside mock'
);

-- carts.payment_method exists with the same four customer-selectable values
-- (mock deliberately excluded — never customer-selectable).
select ok(
  (select data_type = 'text' from information_schema.columns
   where table_schema = 'public' and table_name = 'carts' and column_name = 'payment_method'),
  'carts.payment_method column exists'
);
select ok(
  (select pg_get_constraintdef(oid) like '%moyasar%' and pg_get_constraintdef(oid) not like '%mock%'
   from pg_constraint where conrelid = 'public.carts'::regclass and conname = 'carts_payment_method_check'),
  'carts.payment_method check constraint excludes mock (never customer-selectable)'
);

-- create_payment_attempt no longer takes a provider argument — it derives
-- the provider server-side from the order's own cart.payment_method.
select is(
  (select count(*)::int from pg_proc
   where proname = 'create_payment_attempt' and pronargs = 1),
  1,
  'create_payment_attempt takes only p_order_id (provider is derived, not asserted by the caller)'
);

-- mark_cash_payment_collected exists and is staff-permission-gated
-- unconditionally (unlike create_order_from_cart/create_payment_attempt,
-- which only check permission when auth.uid() is not null) — a human
-- always has to be signed in to say cash was collected.
select ok(
  (select count(*)::int from pg_proc where proname = 'mark_cash_payment_collected') = 1,
  'mark_cash_payment_collected exists'
);
select ok(
  (select prosrc like '%has_permission%' and prosrc not like '%auth.uid() is not null and not app.has_permission%'
   from pg_proc where proname = 'mark_cash_payment_collected'),
  'mark_cash_payment_collected checks orders.write unconditionally, not only when auth.uid() is set'
);

select * from finish();
rollback;
