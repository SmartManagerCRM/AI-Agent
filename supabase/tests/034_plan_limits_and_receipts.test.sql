-- pgTAP: plan limits and order receipts.
--   A  plans: the two new limits; the website reads the branch limit, never the AI one
--   B  branch limit: adding or re-activating an active branch past it is refused; inactive ones don't count
--   C  paid AI responses: used up → AI limited (deterministic replies only); the subscriber sees only a percent
--   D  receipts: created with the order, refreshed with its details, readable with orders.read only
--   E  printing: automatic printing is claimed once, manual printing is counted
begin;
select plan(38);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f0aa1', 'limits-owner@test.local'),
  ('00000000-0000-4000-8000-0000000f0aa2', 'limits-other@test.local');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone, contact_phone, legal_name, vat_number, address) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'limits-a', '{"en":"Limits A"}', 'restaurant', 'active', 'USD', 'UTC', '+966 11 000 0000',
   'Limits A Trading Co.', '300000000000003', 'King Fahd Rd, Riyadh'),
  ('00000000-0000-4000-8000-0000000f0bb2', 'limits-b', '{"en":"Limits B"}', 'restaurant', 'active', 'USD', 'UTC', null, null, null, null);
insert into public.tenant_settings (tenant_id) values
  ('00000000-0000-4000-8000-0000000f0bb1'), ('00000000-0000-4000-8000-0000000f0bb2')
  on conflict (tenant_id) do nothing;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f0bb1', '00000000-0000-4000-8000-0000000f0aa1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000f0bb2', '00000000-0000-4000-8000-0000000f0aa2', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscription_plans (key, name, price_minor, currency, billing_interval, is_active, is_public, sort_order, max_branches, ai_response_limit) values
  ('c34_small', '{"en":"Small"}', 7900, 'USD', 'month', true, true, 94, 2, 3),
  ('c34_open', '{"en":"Open"}', 9900, 'USD', 'month', true, true, 95, null, null);
delete from public.subscriptions where tenant_id in ('00000000-0000-4000-8000-0000000f0bb1', '00000000-0000-4000-8000-0000000f0bb2');
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at, current_period_start, current_period_end) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'c34_small', 'active', now() - interval '20 days', now() - interval '10 days', now() + interval '20 days'),
  ('00000000-0000-4000-8000-0000000f0bb2', 'c34_open', 'active', now() - interval '20 days', now() - interval '10 days', now() + interval '20 days');
insert into public.branches (id, tenant_id, name, address, phone, is_default) values
  ('00000000-0000-4000-8000-0000000f0cc1', '00000000-0000-4000-8000-0000000f0bb1', '{"en":"Olaya"}', '{"en":"Olaya St, Riyadh"}', '+966 11 111 1111', true);
insert into public.products (id, tenant_id, name, price_minor, status) values
  ('00000000-0000-4000-8000-0000000f0dd1', '00000000-0000-4000-8000-0000000f0bb1', '{"en":"Flat White","ar":"فلات وايت"}', 1500, 'active'),
  ('00000000-0000-4000-8000-0000000f0dd2', '00000000-0000-4000-8000-0000000f0bb1', '{"en":"Croissant"}', 900, 'active');
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

-- ── A: plans ────────────────────────────────────────────────────────────
select throws_ok($$ update public.subscription_plans set max_branches = 0 where key = 'c34_small' $$, '23514', null,
  'a branch limit is at least 1');
select throws_ok($$ update public.subscription_plans set ai_response_limit = -5 where key = 'c34_small' $$, '23514', null,
  'an AI response limit is at least 1');
set local role anon;
select is((select max_branches from public.public_subscription_plans() where key = 'c34_small'), 2,
  'the website reads a plan''s branch limit');
reset role;
select is((select count(*)::int from information_schema.routines r
            join information_schema.parameters p on p.specific_name = r.specific_name
           where r.routine_name = 'public_subscription_plans' and p.parameter_name = 'ai_response_limit'), 0,
  '… but never its AI response limit');

-- ── B: branch limit ─────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select is(public.tenant_branch_allowance('00000000-0000-4000-8000-0000000f0bb1'), '{"limit": 2, "active": 1}'::jsonb,
  'the owner sees the plan''s branch limit and the active branches');
select lives_ok($$ insert into public.branches (id, tenant_id, name) values
  ('00000000-0000-4000-8000-0000000f0cc2', '00000000-0000-4000-8000-0000000f0bb1', '{"en":"Malqa"}') $$,
  'a second branch fits the plan');
select throws_ok($$ insert into public.branches (tenant_id, name) values ('00000000-0000-4000-8000-0000000f0bb1', '{"en":"Third"}') $$,
  'P0001', 'BRANCH_LIMIT: this plan allows 2 active branch(es)', 'a third active branch is refused');
select lives_ok($$ insert into public.branches (id, tenant_id, name, is_active) values
  ('00000000-0000-4000-8000-0000000f0cc3', '00000000-0000-4000-8000-0000000f0bb1', '{"en":"Closed"}', false) $$,
  'an inactive branch can still be added');
select throws_ok($$ update public.branches set is_active = true where id = '00000000-0000-4000-8000-0000000f0cc3' $$,
  'P0001', null, '… but not re-activated past the limit');
select lives_ok($$ update public.branches set name = '{"en":"Malqa North"}' where id = '00000000-0000-4000-8000-0000000f0cc2' $$,
  'editing a branch already counted is fine');
select lives_ok($$ update public.branches set is_active = false where id = '00000000-0000-4000-8000-0000000f0cc2' $$,
  'suspending a branch frees a place …');
select lives_ok($$ update public.branches set is_active = true where id = '00000000-0000-4000-8000-0000000f0cc3' $$,
  '… for another one');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa2","role":"authenticated"}';
select throws_ok($$ select public.tenant_branch_allowance('00000000-0000-4000-8000-0000000f0bb1') $$, '42501', null,
  'another business can''t read it');
select lives_ok($$ insert into public.branches (tenant_id, name) select '00000000-0000-4000-8000-0000000f0bb2', jsonb_build_object('en', 'B' || g) from generate_series(1, 4) g $$,
  'a plan without a branch limit takes any number');
reset role;

-- ── C: paid AI responses ────────────────────────────────────────────────
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, success, estimated_cost_usd)
select '00000000-0000-4000-8000-0000000f0bb1', 'customer_message', 'ai', 'gemini', 'c34-model', true, 0.0001 from generate_series(1, 2);
insert into public.agent_interactions (tenant_id, request_type, handled_by, deterministic_rule, provider, model, success, estimated_cost_usd) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'customer_message', 'deterministic', 'c34_rule', null, null, true, 0),
  ('00000000-0000-4000-8000-0000000f0bb1', 'brain_ingestion', 'ai', null, 'gemini', 'c34-model', true, 0.01),
  ('00000000-0000-4000-8000-0000000f0bb1', 'customer_message', 'ai', null, 'gemini', 'c34-model', false, 0);
select is((app.usage_snapshot('00000000-0000-4000-8000-0000000f0bb1', false) ->> 'ai_responses_used')::int, 2,
  'only the Agent''s successful AI replies count (not deterministic ones, Business Brain or failures)');
select is(app.usage_snapshot('00000000-0000-4000-8000-0000000f0bb1', false) ->> 'ai_state', 'ok',
  '2 of 3 used (67%, under the 80% warning): AI still on');
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, success, estimated_cost_usd) values
  ('00000000-0000-4000-8000-0000000f0bb1', 'customer_message', 'ai', 'gemini', 'c34-model', true, 0.0001);
select is(app.usage_snapshot('00000000-0000-4000-8000-0000000f0bb1', false) ->> 'ai_state', 'blocked',
  'the allowance used up: AI is limited');
select is(app.usage_snapshot('00000000-0000-4000-8000-0000000f0bb1', false) ->> 'usage_state', 'AI_RESPONSE_LIMIT_REACHED',
  '… shown to the Super Admin as the response limit (not the cost cap)');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.ai_usage_check('00000000-0000-4000-8000-0000000f0bb1') ->> 'ai_state', 'blocked',
  'the usage guard sees it before any model call');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select ok(
  (select s ->> 'ai_response_percent' = '100' and (s ->> 'ai_limited')::boolean
          and not (s ? 'ai_responses_used') and not (s ? 'ai_response_limit') and not (s ? 'ai_block_reason')
     from public.tenant_usage_summary('00000000-0000-4000-8000-0000000f0bb1') s),
  'the subscriber sees 100% and "AI limited" — no count, no limit, no reason');
reset role;

-- ── D: receipts ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select ok(set_config('c34.order', (select order_id::text from public.create_manual_orders('00000000-0000-4000-8000-0000000f0bb1', jsonb_build_array(jsonb_build_object(
  'customer_name', 'Nora', 'customer_phone', '+966 50 000 0000', 'fulfillment_type', 'pickup',
  'items', jsonb_build_array(
    jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000f0dd1', 'quantity', 2),
    jsonb_build_object('product_id', '00000000-0000-4000-8000-0000000f0dd2', 'quantity', 1)))))), true) is not null,
  'the owner adds an order');
reset role;
set constraints all immediate;
select is((select count(*)::int from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid), 1,
  'an order gets its receipt');
select is((select r.receipt_number from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid),
  (select 'R-' || lpad(order_number::text, 6, '0') from public.orders where id = current_setting('c34.order')::uuid), 'numbered after the order');
select ok((select d -> 'business' ->> 'vat_number' = '300000000000003' and d -> 'business' ->> 'legal_name' = 'Limits A Trading Co.'
                  and d -> 'business' ->> 'address' = 'King Fahd Rd, Riyadh' and d -> 'branch' -> 'name' ->> 'en' = 'Olaya'
             from (select r.details d from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid) x),
  'it carries the business''s legal name, VAT number, address and the branch');
select ok((select jsonb_array_length(d -> 'items') = 2 and (d -> 'order' ->> 'total_minor')::bigint = 3900
                  and d -> 'customer' ->> 'name' = 'Nora' and d -> 'order' ->> 'payment_method' = 'cash_on_delivery'
             from (select r.details d from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid) x),
  '… the lines, the total, the customer and the payment method');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select lives_ok(format($$ select public.update_order_details(%L, 'Nora A.', '+966 50 000 0000', 'nora@test.local', '', 'no sugar') $$,
  current_setting('c34.order')::uuid), 'the owner corrects the customer''s details');
select is((select r.details -> 'customer' ->> 'email' from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid), 'nora@test.local',
  '… and the receipt follows');
select is((public.order_receipt(current_setting('c34.order')::uuid) ->> 'receipt_number'),
  (select 'R-' || lpad(order_number::text, 6, '0') from public.orders where id = current_setting('c34.order')::uuid), 'the owner reads the receipt for printing');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa2","role":"authenticated"}';
select throws_ok(format($$ select public.order_receipt(%L) $$, current_setting('c34.order')::uuid), '42501', null,
  'another business can''t');
select is((select count(*)::int from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid), 0,
  '… nor see it in the table');
reset role;

-- ── E: printing ─────────────────────────────────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select ok(public.record_receipt_print(current_setting('c34.order')::uuid, true), 'the first console to print it automatically claims it');
select ok(not public.record_receipt_print(current_setting('c34.order')::uuid, true), '… a second one (another tab or device) does not');
select ok(public.record_receipt_print(current_setting('c34.order')::uuid, false), 'printing on a click always works');
reset role;
select is((select print_count from public.order_receipts r where r.order_id = current_setting('c34.order')::uuid), 2, 'both prints are counted');

-- ── F: the print mode setting (tenant_settings is granted column by column) ──
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f0aa1","role":"authenticated"}';
select is((select receipt_print_mode from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-0000000f0bb1'), 'manual',
  'a member reads the print mode (manual by default)');
update public.tenant_settings set receipt_print_mode = 'auto' where tenant_id = '00000000-0000-4000-8000-0000000f0bb1';
select is((select receipt_print_mode from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-0000000f0bb1'), 'auto',
  'the owner switches to automatic printing');
update public.tenant_settings set receipt_print_mode = 'auto' where tenant_id = '00000000-0000-4000-8000-0000000f0bb2';
select throws_ok($$ update public.tenant_settings set receipt_print_mode = 'sometimes' where tenant_id = '00000000-0000-4000-8000-0000000f0bb1' $$,
  '23514', null, 'only manual or auto');
reset role;
select is((select receipt_print_mode from public.tenant_settings where tenant_id = '00000000-0000-4000-8000-0000000f0bb2'), 'manual',
  'another business''s setting is untouched');

select * from finish();
rollback;
