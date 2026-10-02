-- pgTAP: manual orders, Business Brain → catalog drafts, analysis-finished event.
--   A  create_manual_orders: priced like checkout, all-or-nothing, permission-checked
--   B  approving / rejecting a Brain product or service updates its catalog draft
--   C  an analysis ending records brain_analysis_finished for that business only
begin;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000c0a1', 'manual-owner@test.local'),
  ('00000000-0000-4000-8000-00000000c0a2', 'manual-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-00000000c0b1', 'manual-a', '{"en":"Manual A"}', 'restaurant', 'active', 'SAR'),
  ('00000000-0000-4000-8000-00000000c0b2', 'manual-b', '{"en":"Manual B"}', 'restaurant', 'active', 'SAR');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000c0b1', '00000000-0000-4000-8000-00000000c0a1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-00000000c0b2', '00000000-0000-4000-8000-00000000c0a2', id from public.roles where key = 'business_owner' and tenant_id is null;
-- 15 % tax on top, SAR 10.00 delivery fee.
insert into public.tenant_settings (tenant_id, checkout) values
  ('00000000-0000-4000-8000-00000000c0b1', '{"tax_rate_bps": 1500, "tax_included": false, "delivery_fee_minor": 1000}'),
  ('00000000-0000-4000-8000-00000000c0b2', '{}');
insert into public.tenant_counters (tenant_id, next_order_number) values
  ('00000000-0000-4000-8000-00000000c0b1', 2000), ('00000000-0000-4000-8000-00000000c0b2', 1000);
insert into public.products (id, tenant_id, name, price_minor, status) values
  ('00000000-0000-4000-8000-00000000c0d1', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Latte"}', 1800, 'active'),
  ('00000000-0000-4000-8000-00000000c0d2', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Cake"}', 2500, 'active'),
  ('00000000-0000-4000-8000-00000000c0d3', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Old item"}', 900, 'archived'),
  ('00000000-0000-4000-8000-00000000c0d9', '00000000-0000-4000-8000-00000000c0b2', '{"en":"Other shop"}', 500, 'active');
set constraints all immediate;

-- ── A. Manual orders ────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a1","role":"authenticated"}';
create temp table single as select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":2},{"product_id":"00000000-0000-4000-8000-00000000c0d2","quantity":1}],
     "fulfillment_type":"delivery","customer_name":"Sara","customer_phone":"+966500000001","delivery_address":"King Fahd Rd 12"}]');
reset role;
select is((select count(*)::int from single), 1, 'one order created');
select is((select order_number from single), 2000, 'it takes the next order number');
select is((select subtotal_minor || '/' || delivery_fee_minor || '/' || tax_minor || '/' || total_minor from public.orders where id = (select order_id from single)),
  '6100/1000/1065/8165', 'priced like checkout: live prices + delivery fee + 15 % tax');
select is((select status || '|' || created_via || '|' || fulfillment_type from public.orders where id = (select order_id from single)),
  'confirmed|manual|delivery', 'confirmed, marked as a manual order');
select is((select delivery_address ->> 'formatted' from public.orders where id = (select order_id from single)), 'King Fahd Rd 12', 'address stored like checkout');
select is((select count(*)::int from public.order_items where order_id = (select order_id from single)), 2, 'both lines saved');
select is((select provider || '|' || status || '|' || amount_minor from public.payments where order_id = (select order_id from single)),
  'cash_on_delivery|pending|8165', 'cash payment record awaiting collection');
select is((select payload ->> 'created_via' from public.notification_events where entity_id = (select order_id from single)), 'manual',
  'other devices still get the new-order event');
select is((select payload ->> 'created_by' from public.notification_events where entity_id = (select order_id from single)),
  '00000000-0000-4000-8000-00000000c0a1', '… knowing who entered it');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a1","role":"authenticated"}';
create temp table bulk as select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"ref":"A","items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":1}],"paid":true},
    {"ref":"B","items":[{"product_id":"00000000-0000-4000-8000-00000000c0d2","quantity":3}],"fulfillment_type":"dine_in"},
    {"ref":"C","items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":1}]}]', 'bulk_import');
select throws_like($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"ref":"ok","items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":1}]},
    {"ref":"bad","items":[{"product_id":"00000000-0000-4000-8000-00000000c0d9","quantity":1}]}]') $$,
  '%order bad: a product is not in your catalog%', 'another business''s product is refused, naming the order');
select throws_like($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000c0d3","quantity":1}]}]') $$,
  '%not in your catalog%', 'archived products cannot be ordered');
select throws_like($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":0}]}]') $$,
  '%quantities must be whole numbers%', 'quantity 0 refused');
select throws_like($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":1}],"fulfillment_type":"delivery"}]') $$,
  '%needs a delivery address%', 'delivery without an address refused');
reset role;
select is((select count(*)::int from bulk), 3, 'bulk: three orders created');
select is((select string_agg(order_number::text, ',' order by order_number) from bulk), '2001,2002,2003', 'bulk: consecutive numbers');
select is((select count(*)::int from public.orders where tenant_id = '00000000-0000-4000-8000-00000000c0b1'), 4,
  'a batch with one bad order adds nothing at all');
select is((select p.status from public.payments p join bulk b on b.order_id = p.order_id join public.orders o on o.id = b.order_id
  where o.order_number = 2001), 'succeeded', '"paid" orders are recorded as collected');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a2","role":"authenticated"}';
select throws_ok($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1',
  '[{"items":[{"product_id":"00000000-0000-4000-8000-00000000c0d1","quantity":1}]}]') $$,
  '42501', null, 'another business''s owner cannot add orders here');
reset role;
set local role anon;
select throws_ok($$ select * from public.create_manual_orders('00000000-0000-4000-8000-00000000c0b1', '[]') $$,
  '42501', null, 'anonymous callers cannot add orders');
reset role;

-- ── B. Brain approval → catalog draft ───────────────────────────────────
insert into public.products (id, tenant_id, name, price_minor, status, source, brain_fact_key) values
  ('00000000-0000-4000-8000-00000000c0e1', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Spanish Latte"}', 1800, 'draft', 'brain', 'spanish latte'),
  ('00000000-0000-4000-8000-00000000c0e2', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Noise"}', 100, 'draft', 'brain', 'noise');
insert into public.bookable_services (id, tenant_id, name, duration_minutes, is_active, source, brain_fact_key) values
  ('00000000-0000-4000-8000-00000000c0f1', '00000000-0000-4000-8000-00000000c0b1', '{"en":"Haircut"}', 30, false, 'brain', 'haircut');
insert into public.business_brain_entries (id, tenant_id, entry_type, entry_key, fact_key, content, source_type) values
  ('00000000-0000-4000-8000-00000000c0c1', '00000000-0000-4000-8000-00000000c0b1', 'product_candidate', 'spanish latte@website', 'spanish latte',
   '{"normalized":{"name":"Spanish Latte","amount":"19.50","currency":"SAR"}}', 'website'),
  ('00000000-0000-4000-8000-00000000c0c2', '00000000-0000-4000-8000-00000000c0b1', 'product_candidate', 'noise@website', 'noise',
   '{"normalized":{"name":"Noise","amount":"1","currency":"SAR"}}', 'website'),
  ('00000000-0000-4000-8000-00000000c0c3', '00000000-0000-4000-8000-00000000c0b1', 'service_candidate', 'haircut@website', 'haircut',
   '{"normalized":{"name":"Haircut","amount":"40","currency":"SAR"}}', 'website');
select is((select status from public.products where id = '00000000-0000-4000-8000-00000000c0e1'), 'draft', 'pending Brain product stays a draft');
update public.business_brain_entries set status = 'approved' where id = '00000000-0000-4000-8000-00000000c0c1';
select is((select status || '|' || price_minor from public.products where id = '00000000-0000-4000-8000-00000000c0e1'), 'active|1950',
  'approving it activates the draft with the approved price');
update public.business_brain_entries set status = 'rejected' where id = '00000000-0000-4000-8000-00000000c0c2';
select is((select status from public.products where id = '00000000-0000-4000-8000-00000000c0e2'), 'archived', 'rejecting it archives the draft');
update public.business_brain_entries set status = 'approved' where id = '00000000-0000-4000-8000-00000000c0c3';
select ok((select is_active from public.bookable_services where id = '00000000-0000-4000-8000-00000000c0f1'), 'approving a service activates it');
update public.products set status = 'active' where id = '00000000-0000-4000-8000-00000000c0d2';
update public.business_brain_entries set status = 'archived' where id = '00000000-0000-4000-8000-00000000c0c1';
select is((select status from public.products where id = '00000000-0000-4000-8000-00000000c0e1'), 'active',
  'an already-active product is never archived by the Brain');

-- ── C. Analysis finished ────────────────────────────────────────────────
insert into public.brain_ingestion_jobs (id, tenant_id, status, created_at) values
  ('00000000-0000-4000-8000-00000000c0aa', '00000000-0000-4000-8000-00000000c0b1', 'extracting', now() - interval '1 hour');
update public.brain_ingestion_jobs set status = 'ready_for_review', facts_proposed = 3 where id = '00000000-0000-4000-8000-00000000c0aa';
update public.brain_ingestion_jobs set status = 'completed' where id = '00000000-0000-4000-8000-00000000c0aa';
select is((select count(*)::int from public.notification_events where kind = 'brain_analysis_finished' and entity_id = '00000000-0000-4000-8000-00000000c0aa'),
  1, 'analysis end → one event (not again on a later status change)');
select is((select (payload ->> 'products_added') || '/' || (payload ->> 'services_added') from public.notification_events
  where kind = 'brain_analysis_finished' and entity_id = '00000000-0000-4000-8000-00000000c0aa'), '2/1', '… with what it added to the catalog');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000c0a2","role":"authenticated"}';
select is((select count(*)::int from public.notification_events where tenant_id = '00000000-0000-4000-8000-00000000c0b1'), 0,
  'another business sees none of these events');
reset role;

select * from finish();
rollback;
