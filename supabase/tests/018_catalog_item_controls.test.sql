-- pgTAP: Products & Services controls.
--   A  suspended products; a product priced only in another currency can never go live
--   B  Brain approvals: activate a needs-price draft only with a price in the business's currency;
--      never revive a deleted service
--   C  manual orders refuse a product that still needs its price
--   D  tenant isolation: another business cannot edit, suspend or delete these items
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000d0a1', 'controls-owner@test.local'),
  ('00000000-0000-4000-8000-00000000d0a2', 'controls-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-00000000d0b1', 'controls-a', '{"en":"Controls A"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-00000000d0b2', 'controls-b', '{"en":"Controls B"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000d0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000d0b2', '00000000-0000-4000-8000-00000000d0a2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_settings (tenant_id, checkout) values ('00000000-0000-4000-8000-00000000d0b1', '{}');
insert into public.tenant_counters (tenant_id, next_order_number) values ('00000000-0000-4000-8000-00000000d0b1', 1);
insert into public.products (id, tenant_id, name, price_minor, status, source, brain_fact_key, source_price) values
  ('00000000-0000-4000-8000-00000000d0d1', '00000000-0000-4000-8000-00000000d0b1', '{"en":"Burger"}', 1200, 'active', 'manual', null, null),
  ('00000000-0000-4000-8000-00000000d0d2', '00000000-0000-4000-8000-00000000d0b1', '{"en":"Cappuccino"}', 0, 'draft', 'brain', 'cappuccino',
   '{"amount":"15.00","currency":"SAR"}'),
  ('00000000-0000-4000-8000-00000000d0d3', '00000000-0000-4000-8000-00000000d0b1', '{"en":"Brownie"}', 0, 'draft', 'brain', 'brownie',
   '{"amount":"20.00","currency":"SAR"}');
insert into public.bookable_services (id, tenant_id, name, duration_minutes, is_active, source, brain_fact_key, archived_at) values
  ('00000000-0000-4000-8000-00000000d0f1', '00000000-0000-4000-8000-00000000d0b1', '{"en":"Massage"}', 60, false, 'brain', 'massage', now());
set constraints all immediate;

-- ── A. Suspended / needs-price ──────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a1","role":"authenticated"}';
update public.products set status = 'suspended' where id = '00000000-0000-4000-8000-00000000d0d1';
select is((select status from public.products where id = '00000000-0000-4000-8000-00000000d0d1'), 'suspended', 'the owner can suspend a product');
update public.products set status = 'active' where id = '00000000-0000-4000-8000-00000000d0d1';
select is((select status from public.products where id = '00000000-0000-4000-8000-00000000d0d1'), 'active', '… and put it back on sale');
select throws_ok($$ update public.products set status = 'active' where id = '00000000-0000-4000-8000-00000000d0d2' $$,
  '23514', null, 'a product priced only in another currency cannot go live');
select throws_ok($$ update public.products set status = 'paused' where id = '00000000-0000-4000-8000-00000000d0d1' $$,
  '23514', null, 'unknown statuses are refused');
update public.products set price_minor = 450, source_price = null, status = 'active' where id = '00000000-0000-4000-8000-00000000d0d3';
select is((select status || '/' || price_minor from public.products where id = '00000000-0000-4000-8000-00000000d0d3'), 'active/450',
  'once the owner sets their own price it can go live');
reset role;

-- ── B. Brain approvals ──────────────────────────────────────────────────
insert into public.business_brain_entries (id, tenant_id, entry_type, entry_key, fact_key, content, source_type) values
  ('00000000-0000-4000-8000-00000000d0c1', '00000000-0000-4000-8000-00000000d0b1', 'product_candidate', 'cappuccino@website', 'cappuccino',
   '{"normalized":{"name":"Cappuccino","amount":"15.00","currency":"SAR"}}', 'website'),
  ('00000000-0000-4000-8000-00000000d0c2', '00000000-0000-4000-8000-00000000d0b1', 'product_candidate', 'cappuccino@manual', 'cappuccino',
   '{"normalized":{"name":"Cappuccino","amount":"4.50","currency":"USD"}}', 'manual'),
  ('00000000-0000-4000-8000-00000000d0c3', '00000000-0000-4000-8000-00000000d0b1', 'service_candidate', 'massage@website', 'massage',
   '{"normalized":{"name":"Massage","amount":"80","currency":"USD"}}', 'website');
update public.business_brain_entries set status = 'approved' where id = '00000000-0000-4000-8000-00000000d0c1';
select is((select status || '/' || price_minor || '/' || (source_price is not null) from public.products where id = '00000000-0000-4000-8000-00000000d0d2'),
  'draft/0/true', 'approving the SAR price does not put it on sale in a USD business');
update public.business_brain_entries set status = 'approved' where id = '00000000-0000-4000-8000-00000000d0c2';
select is((select status || '/' || price_minor || '/' || (source_price is null) from public.products where id = '00000000-0000-4000-8000-00000000d0d2'),
  'active/450/true', 'approving a USD price sets it, clears the foreign price and activates the draft');
update public.business_brain_entries set status = 'approved' where id = '00000000-0000-4000-8000-00000000d0c3';
select is((select is_active from public.bookable_services where id = '00000000-0000-4000-8000-00000000d0f1'), false,
  'a deleted service is not revived by a Brain approval');
select throws_ok($$ update public.bookable_services set is_active = true where id = '00000000-0000-4000-8000-00000000d0f1' $$,
  '23514', null, 'a deleted service cannot be active');

-- ── C. Manual orders ────────────────────────────────────────────────────
update public.products set status = 'draft', source_price = '{"amount":"3","currency":"EUR"}', price_minor = 0
  where id = '00000000-0000-4000-8000-00000000d0d3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a1","role":"authenticated"}';
select throws_like($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000d0b1',
  '[{"ref":"X","items":[{"product_id":"00000000-0000-4000-8000-00000000d0d3","quantity":1}]}]') $$,
  '%a product still needs its price%', 'a product waiting for its price cannot be ordered (it would cost 0)');
select lives_ok($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000d0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000d0d1","quantity":1}]}]') $$, 'a priced product still can');
reset role;

-- ── D. Tenant isolation ─────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000d0a2","role":"authenticated"}';
update public.products set status = 'archived' where id = '00000000-0000-4000-8000-00000000d0d1';
update public.products set name = '{"en":"Hacked"}', price_minor = 1 where id = '00000000-0000-4000-8000-00000000d0d1';
update public.bookable_services set archived_at = null where id = '00000000-0000-4000-8000-00000000d0f1';
select is((select count(*)::int from public.products where tenant_id = '00000000-0000-4000-8000-00000000d0b1'), 0,
  'another business cannot even see these products');
reset role;
select is((select status || '/' || (name ->> 'en') || '/' || price_minor from public.products where id = '00000000-0000-4000-8000-00000000d0d1'),
  'active/Burger/1200', 'another business cannot delete or edit a product');
select ok((select archived_at is not null from public.bookable_services where id = '00000000-0000-4000-8000-00000000d0f1'),
  'another business cannot restore a deleted service');

-- ── Schema ──────────────────────────────────────────────────────────────
select is((select data_type from information_schema.columns
  where table_schema = 'public' and table_name = 'products' and column_name = 'source_price'), 'jsonb', 'products.source_price');
select is((select data_type from information_schema.columns
  where table_schema = 'public' and table_name = 'bookable_services' and column_name = 'archived_at'),
  'timestamp with time zone', 'bookable_services.archived_at');

select * from finish();
rollback;
