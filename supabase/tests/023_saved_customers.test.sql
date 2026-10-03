-- pgTAP: customers a business adds itself (Customers → Add customer).
--   A  who may add, see, change and delete them (RLS, per business)
--   B  one saved customer per email and per phone number
--   C  the Customers list: saved customers with their matched orders, others from orders as before
begin;
select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000c0aa1', 'cust-owner@test.local'),
  ('00000000-0000-4000-8000-0000000c0aa2', 'cust-staff@test.local'),
  ('00000000-0000-4000-8000-0000000c0aa3', 'cust-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'cust-a', '{"en":"Cust A"}', 'restaurant', 'active', 'USD'),
  ('00000000-0000-4000-8000-0000000c0bb2', 'cust-b', '{"en":"Cust B"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000c0bb1', '00000000-0000-4000-8000-0000000c0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000c0bb1', '00000000-0000-4000-8000-0000000c0aa2', id from public.roles where key = 'staff' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000c0bb2', '00000000-0000-4000-8000-0000000c0aa3', id from public.roles where key = 'business_owner' and tenant_id is null;
-- Orders through the Agent: Sara by email (different case), Omar by phone (different formatting), Lina not saved.
insert into public.orders (id, tenant_id, order_number, status, fulfillment_type, currency, subtotal_minor, total_minor, customer_name, customer_email, customer_phone) values
  ('00000000-0000-4000-8000-0000000c0cc1', '00000000-0000-4000-8000-0000000c0bb1', 2001, 'completed', 'pickup', 'USD', 1000, 1000, 'Sara', 'SARA@Example.com', null),
  ('00000000-0000-4000-8000-0000000c0cc2', '00000000-0000-4000-8000-0000000c0bb1', 2002, 'completed', 'pickup', 'USD', 1500, 1500, 'Sara A', 'sara@example.com', '+974 5000 1111'),
  ('00000000-0000-4000-8000-0000000c0cc3', '00000000-0000-4000-8000-0000000c0bb1', 2003, 'completed', 'pickup', 'USD', 700, 700, 'Omar', null, '974-5000-2222'),
  ('00000000-0000-4000-8000-0000000c0cc4', '00000000-0000-4000-8000-0000000c0bb1', 2004, 'completed', 'pickup', 'USD', 400, 400, 'Lina', 'lina@example.com', null);
set constraints all immediate;

-- ── A: the owner adds customers ─────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0aa1","role":"authenticated"}';
select lives_ok($$ insert into public.customers (tenant_id, name, email, phone, notes) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Sara Ahmed', 'sara@example.com', null, 'Regular') $$,
  'the owner adds a customer');
select lives_ok($$ insert into public.customers (tenant_id, name, phone) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Omar', '+974 5000 2222') $$, '… and one with only a phone number');
select lives_ok($$ insert into public.customers (tenant_id, name) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Walk-in Ali') $$, '… and one with only a name');

-- ── B: duplicates ───────────────────────────────────────────────────────
select throws_ok($$ insert into public.customers (tenant_id, name, email) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Copy', 'Sara@Example.com') $$, '23505', null, 'the same email (any case) can''t be saved twice');
select throws_ok($$ insert into public.customers (tenant_id, name, phone) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Copy', '974 5000 2222') $$, '23505', null, 'the same phone number (any formatting) can''t be saved twice');
select throws_ok($$ insert into public.customers (tenant_id, name, email) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Bad', 'not-an-email') $$, '23514', null, 'an email must look like one');
select is((select created_by from public.customers where name = 'Sara Ahmed'), '00000000-0000-4000-8000-0000000c0aa1'::uuid, 'who added a customer is recorded');
select throws_ok($$ insert into public.customers (tenant_id, name, created_by) values
  ('00000000-0000-4000-8000-0000000c0bb1', 'Spoof', '00000000-0000-4000-8000-0000000c0aa3') $$, '42501', null, '… and can''t be set by the member');
select throws_ok($$ update public.customers set phone_key = '1' where name = 'Omar' $$, '428C9', null, 'the match keys are computed, never written');

-- ── C: the Customers list ───────────────────────────────────────────────
create temp table s as select public.tenant_customer_summary('00000000-0000-4000-8000-0000000c0bb1', null, 50, 0) as j;
select is((select (j ->> 'customers')::int from s), 4, 'four customers: Sara, Omar, Walk-in Ali (saved) and Lina (from orders)');
select is((select r ->> 'name' from s, jsonb_array_elements(j -> 'rows') r where r ->> 'customer_id' is not null and r ->> 'email' = 'sara@example.com'),
  'Sara Ahmed', 'the saved name is shown');
select is((select (r ->> 'order_count')::int from s, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Sara Ahmed'), 2,
  'both of Sara''s orders match her by email, whatever the case');
select is((select (r ->> 'total_spent_minor')::int from s, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Sara Ahmed'), 2500, '… and her spend adds up');
select is((select (r ->> 'order_count')::int from s, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Omar'), 1,
  'Omar''s order matches him by phone digits');
select is((select (r ->> 'order_count')::int from s, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Walk-in Ali'), 0,
  'a saved customer with no orders yet is listed with none');
select is((select r -> 'customer_id' from s, jsonb_array_elements(j -> 'rows') r where r ->> 'name' = 'Lina'), 'null'::jsonb,
  'a customer known only from orders is still listed');
select is((select (j ->> 'filtered_count')::int from (select public.tenant_customer_summary('00000000-0000-4000-8000-0000000c0bb1', '5000 2222', 50, 0) as j) x), 1,
  'search finds a customer by phone');
select lives_ok($$ update public.customers set notes = 'VIP', birthday = '1990-05-01' where name = 'Omar' $$, 'the owner edits a customer');

-- Staff can see, not change.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0aa2","role":"authenticated"}';
select is((select count(*)::int from public.customers), 3, 'staff see the business''s saved customers');
select throws_ok($$ insert into public.customers (tenant_id, name) values ('00000000-0000-4000-8000-0000000c0bb1', 'X') $$, '42501', null,
  'staff can''t add customers');

-- Another business sees none of them and can't add to this one.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0aa3","role":"authenticated"}';
select is((select (j ->> 'customers')::int from (select public.tenant_customer_summary('00000000-0000-4000-8000-0000000c0bb1', null, 50, 0) as j) x), 0,
  'another business sees no customers of this one');

-- The owner deletes one: their orders remain, listed as before.
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000c0aa1","role":"authenticated"}';
delete from public.customers where name = 'Sara Ahmed';
select is((select (r ->> 'order_count')::int from (select public.tenant_customer_summary('00000000-0000-4000-8000-0000000c0bb1', 'sara', 50, 0) as j) x,
  jsonb_array_elements(x.j -> 'rows') r), 2, 'after deleting a saved customer, their orders still show under their email');
reset role;

select * from finish();
rollback;
