-- pgTAP: switching a business's currency converts its prices.
--   A  who may switch; the currency never changes without converting
--   B  conversion: SAR (2 decimals) → KWD (3 decimals) at the supplied rates
--   C  drafts waiting for a price listed in the new currency get it exactly
--   D  the switch is recorded with its rates; reports express old orders in the new currency
--   E  bad input is refused and changes nothing
begin;
select plan(23);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000f0a1', 'fx-owner@test.local'),
  ('00000000-0000-4000-8000-00000000f0a2', 'fx-staff@test.local'),
  ('00000000-0000-4000-8000-00000000f0a3', 'fx-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-00000000f0b1', 'fx-a', '{"en":"FX A"}', 'restaurant', 'active', 'SAR'),
  ('00000000-0000-4000-8000-00000000f0b2', 'fx-b', '{"en":"FX B"}', 'restaurant', 'active', 'SAR');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000f0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b1', '00000000-0000-4000-8000-00000000f0a2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000f0b2', '00000000-0000-4000-8000-00000000f0a3', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_settings (tenant_id, checkout) values
  ('00000000-0000-4000-8000-00000000f0b1', '{"delivery_fee_minor": 1000, "minimum_order_minor": 5000, "tax_rate_bps": 1500}');
insert into public.products (id, tenant_id, name, price_minor, status, source_price) values
  ('00000000-0000-4000-8000-00000000f0d1', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Latte"}', 1800, 'active', null),
  ('00000000-0000-4000-8000-00000000f0d2', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Cake"}', 2500, 'draft', null),
  ('00000000-0000-4000-8000-00000000f0d3', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Mocha"}', 0, 'draft', '{"amount":"1.500","currency":"KWD"}'),
  ('00000000-0000-4000-8000-00000000f0d4', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Tea"}', 0, 'draft', '{"amount":"3.00","currency":"GBP"}'),
  ('00000000-0000-4000-8000-00000000f0d9', '00000000-0000-4000-8000-00000000f0b2', '{"en":"Other"}', 1800, 'active', null);
insert into public.bookable_services (id, tenant_id, name, duration_minutes, price_minor) values
  ('00000000-0000-4000-8000-00000000f0e1', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Class"}', 60, 15000),
  ('00000000-0000-4000-8000-00000000f0e2', '00000000-0000-4000-8000-00000000f0b1', '{"en":"Consult"}', 30, null);
insert into public.coupons (tenant_id, code, discount_type, discount_value, min_order_minor) values
  ('00000000-0000-4000-8000-00000000f0b1', 'FIX10', 'fixed', 1000, 3000),
  ('00000000-0000-4000-8000-00000000f0b1', 'PCT15', 'percentage', 1500, 0);
-- An order placed before the switch (stays in SAR).
insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, currency, subtotal_minor, total_minor) values
  ('00000000-0000-4000-8000-00000000f0c1', '00000000-0000-4000-8000-00000000f0b1', 1001, 'completed', 'pickup', 'SAR', 3750, 3750);
set constraints all immediate;

-- Rates per 1 USD: SAR 3.75, KWD 0.3075 → 1 SAR = 0.082 KWD.
create temp table fx as select '{"USD": 1, "SAR": 3.75, "KWD": 0.3075, "GBP": 0.75}'::jsonb as r;
grant select on fx to authenticated;

-- ── A ─────────────────────────────────────────────────────────────────────
select throws_ok($$ update public.tenants set currency = 'USD' where id = '00000000-0000-4000-8000-00000000f0b1' $$,
  '23514', null, 'the currency never changes by a plain update (prices would stay unconverted)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a2","role":"authenticated"}';
select throws_ok($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'KWD', (select r from fx), 'test', now()) $$,
  '42501', null, 'staff without settings.write cannot switch');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a3","role":"authenticated"}';
select throws_ok($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'KWD', (select r from fx), 'test', now()) $$,
  '42501', null, 'another business''s owner cannot switch it');
reset role;
set local role anon;
select throws_ok($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'KWD', '{}'::jsonb, 'test', now()) $$,
  '42501', null, 'anonymous callers cannot switch');
reset role;

-- ── E (before the real switch) ────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a1","role":"authenticated"}';
select throws_like($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'XYZ', (select r from fx), 'test', now()) $$,
  '%unknown currency%', 'an unknown currency is refused');
select throws_like($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'EUR', (select r from fx), 'test', now()) $$,
  '%no exchange rate between SAR and EUR%', 'no rate for the new currency: refused, never guessed');
select throws_like($$ select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'KWD', '{"SAR": 3.75, "KWD": 0}'::jsonb, 'test', now()) $$,
  '%no exchange rate%', 'a zero rate is refused');
select is((select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'SAR', (select r from fx), 'test', now()) ->> 'changed'),
  'false', 'switching to the current currency changes nothing');

-- ── B/C ───────────────────────────────────────────────────────────────────
create temp table result as
  select public.change_business_currency('00000000-0000-4000-8000-00000000f0b1', 'kwd', (select r from fx), 'open.er-api.com', '2026-10-03T00:00:00Z') as j;
reset role;
select is((select currency::text from public.tenants where id = '00000000-0000-4000-8000-00000000f0b1'), 'KWD', 'the business now sells in KWD');
select is((select price_minor from public.products where id = '00000000-0000-4000-8000-00000000f0d1'), 1476::bigint,
  'SAR 18.00 → KWD 1.476 (three decimals)');
select is((select price_minor from public.products where id = '00000000-0000-4000-8000-00000000f0d2'), 2050::bigint, 'drafts are converted too (SAR 25.00 → KWD 2.050)');
select is((select price_minor || '/' || (source_price is null) || '/' || status from public.products where id = '00000000-0000-4000-8000-00000000f0d3'),
  '1500/true/draft', 'a draft listed at KWD 1.500 gets exactly that price (and stays a draft for review)');
select is((select price_minor || '/' || (source_price ->> 'currency') from public.products where id = '00000000-0000-4000-8000-00000000f0d4'),
  '0/GBP', 'a draft listed in another currency still waits for the owner''s price');
select is((select price_minor from public.products where id = '00000000-0000-4000-8000-00000000f0d9'), 1800::bigint, 'another business''s prices are untouched');
select is((select price_minor from public.bookable_services where id = '00000000-0000-4000-8000-00000000f0e1'), 12300::bigint, 'service SAR 150.00 → KWD 12.300');
select is((select price_minor from public.bookable_services where id = '00000000-0000-4000-8000-00000000f0e2'), null::bigint, '"price on request" stays so');
select is((select discount_value || '/' || min_order_minor from public.coupons where code = 'FIX10' and tenant_id = '00000000-0000-4000-8000-00000000f0b1'),
  '820/2460', 'fixed coupon and its minimum converted');
select is((select discount_value || '/' || min_order_minor from public.coupons where code = 'PCT15' and tenant_id = '00000000-0000-4000-8000-00000000f0b1'),
  '1500/0', 'a percentage coupon is unchanged');
select is((select (checkout ->> 'delivery_fee_minor') || '/' || (checkout ->> 'minimum_order_minor') || '/' || (checkout ->> 'tax_rate_bps')
  from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-00000000f0b1'),
  '820/4100/1500', 'delivery fee and minimum order converted; tax rate unchanged');

-- ── D ─────────────────────────────────────────────────────────────────────
select is((select from_currency || '>' || to_currency || ' ' || round(rate, 6) || ' ' || rate_source from public.tenant_currency_changes
  where tenant_id = '00000000-0000-4000-8000-00000000f0b1'), 'SAR>KWD 0.082000 open.er-api.com', 'the switch is recorded with its rate and source');
select is((select count(*)::int from public.audit_logs where tenant_id = '00000000-0000-4000-8000-00000000f0b1' and action = 'business.currency_changed'), 1,
  'and in the audit log');
select is((select currency::text || ' ' || total_minor from public.orders where id = '00000000-0000-4000-8000-00000000f0c1'), 'SAR 3750',
  'past orders keep their own currency and total');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000f0a1","role":"authenticated"}';
select is((public.tenant_dashboard_stats('00000000-0000-4000-8000-00000000f0b1', 'en', 30) ->> 'total_sales_minor'), '3075',
  'dashboard shows the SAR 37.50 order as KWD 3.075 — never mixes currencies');
reset role;

select * from finish();
rollback;
