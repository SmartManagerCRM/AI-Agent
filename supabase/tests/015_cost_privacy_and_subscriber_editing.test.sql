-- pgTAP: subscribers never see AI cost (UI or API); Super Admin edits subscribers.
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'cost-owner@test.local'),
  ('00000000-0000-4000-8000-0000000000d2', 'cost-admin@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000000d2');
insert into public.tenants (id, slug, business_name, business_type_key, status, currency) values
  ('00000000-0000-4000-8000-0000000000e1', 'cost-privacy', '{"en":"Cost Privacy"}', 'restaurant', 'active', 'USD');
insert into public.tenant_members (tenant_id, user_id, role_id)
select '00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000d1', id from public.roles where key = 'business_owner' and tenant_id is null;
insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
values ('00000000-0000-4000-8000-0000000000e1', 'starter', 'trialing', now() + interval '5 days');
insert into public.agent_interactions (tenant_id, request_type, handled_by, success, estimated_cost_usd, provider, model, input_tokens, output_tokens)
values ('00000000-0000-4000-8000-0000000000e1', 'external_agent', 'ai', true, 0.0123, 'gemini', 'test-model', 100, 20);

-- ── Subscriber: no AI cost through any door ─────────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d1","role":"authenticated"}';
select is((select count(*)::int from public.agent_interactions), 1, 'owner still sees their own interactions');
select throws_ok($$ select estimated_cost_usd from public.agent_interactions $$, '42501', null, 'owner cannot read interaction costs');
select lives_ok($$ select id, handled_by, input_tokens, output_tokens from public.agent_interactions $$, 'owner can read everything else');
select throws_ok($$ select ai_cost_usd from public.brain_ingestion_jobs $$, '42501', null, 'owner cannot read Business Brain AI cost');
select throws_ok($$ select google_cost_usd from public.brain_ingestion_jobs $$, '42501', null, 'owner cannot read Business Brain Google cost');
select throws_ok($$ select budget_usd from public.brain_ingestion_jobs $$, '42501', null, 'owner cannot read Business Brain budgets');
select lives_ok($$ select id, status, pages_processed, facts_proposed from public.brain_ingestion_jobs $$, 'owner can read their analyses');
select throws_ok($$ select input_price_per_million_usd from public.ai_model_configs $$, '42501', null, 'owner cannot read model prices');
select lives_ok($$ select provider, model, kind, is_active from public.ai_model_configs $$, 'owner can read model names');
select is((select total_cost_usd from public.agent_interaction_stats('00000000-0000-4000-8000-0000000000e1')), null,
  'agent_interaction_stats gives a subscriber no cost');
select is((select total_interactions from public.agent_interaction_stats('00000000-0000-4000-8000-0000000000e1')), 1::bigint,
  '… but still the interaction counts');
select is(public.tenant_analytics_stats('00000000-0000-4000-8000-0000000000e1', 'en', 30) ->> 'current_ai_cost_usd', null,
  'tenant_analytics_stats gives a subscriber no cost');
select is((select cost_usd from public.agent_interaction_totals_by_tenant(now() - interval '1 day') limit 1), null,
  'agent_interaction_totals_by_tenant gives a subscriber no cost');

-- ── Subscriber cannot edit anything Super-Admin-only ────────────────────
select throws_ok($$ select public.admin_update_subscription('00000000-0000-4000-8000-0000000000e1', 'pro', 'active', now() + interval '1 year', now(), now() + interval '1 year') $$,
  '42501', null, 'owner cannot change their own subscription');
select throws_ok($$ select public.admin_update_business('00000000-0000-4000-8000-0000000000e1', 'en', 'Hacked', 'restaurant', 'active', null, null, null, null, null, 'UTC', 'en', 'both', null, null) $$,
  '42501', null, 'owner cannot use the Super Admin business editor');
select throws_ok($$ select public.set_subscription_usage_overrides('00000000-0000-4000-8000-0000000000e1', 99999, 9999) $$,
  '42501', null, 'owner cannot raise their own thresholds');
reset role;

-- ── Super Admin: sees costs, edits subscribers ──────────────────────────
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
select is((select total_cost_usd from public.agent_interaction_stats('00000000-0000-4000-8000-0000000000e1')), 0.0123,
  'Super Admin still gets the AI cost');
select is((public.tenant_analytics_stats('00000000-0000-4000-8000-0000000000e1', 'en', 30) ->> 'current_ai_cost_usd')::numeric, 0.0123,
  'Super Admin gets the cost in tenant analytics');

select lives_ok($$ select public.admin_update_business('00000000-0000-4000-8000-0000000000e1', 'en', 'Cost Privacy Café', 'cafe', 'active',
  'hello@cost.test', '+966500000000', 'https://cost.test', 'SA', 'Riyadh', 'Asia/Riyadh', 'ar', 'both', 'Owner Name', '+966511111111') $$,
  'Super Admin edits the business');
reset role;
select is((select business_name ->> 'en' from public.tenants where id = '00000000-0000-4000-8000-0000000000e1'), 'Cost Privacy Café', 'business name saved');
select is((select business_type_key || '|' || timezone || '|' || default_language || '|' || deployment_mode from public.tenants where id = '00000000-0000-4000-8000-0000000000e1'),
  'cafe|Asia/Riyadh|ar|both', 'type, timezone, language and deployment saved');
select ok((select 'ar' = any (enabled_languages) from public.tenants where id = '00000000-0000-4000-8000-0000000000e1'), 'a new default language is enabled too');
select is((select full_name from public.profiles where id = '00000000-0000-4000-8000-0000000000d1'), 'Owner Name', 'owner name saved');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000d2","role":"authenticated"}';
select throws_like($$ select public.admin_update_business('00000000-0000-4000-8000-0000000000e1', 'en', 'X', 'restaurant', 'active', null, null, null, null, null, 'Mars/Olympus', 'en', 'both', null, null) $$,
  '%unknown timezone%', 'invalid timezone refused');
select throws_like($$ select public.admin_update_subscription('00000000-0000-4000-8000-0000000000e1', 'pro', 'active', now(), null, null) $$,
  '%needs its billing period%', 'an active subscription needs a billing period');
select throws_like($$ select public.admin_update_subscription('00000000-0000-4000-8000-0000000000e1', 'pro', 'active', now(), now(), now() - interval '1 day') $$,
  '%must end after it starts%', 'a billing period must end after it starts');
select lives_ok($$ select public.admin_update_subscription('00000000-0000-4000-8000-0000000000e1', 'growth', 'active', now(), '2026-10-17T00:00:00Z', '2026-11-17T00:00:00Z') $$,
  'Super Admin sets plan, status and billing period');
reset role;
select is((select plan_key || '|' || status || '|' || current_period_start::text from public.subscriptions where tenant_id = '00000000-0000-4000-8000-0000000000e1'),
  'growth|active|2026-10-17 00:00:00+00', 'subscription saved');
select is((select count(*)::int from public.audit_logs where tenant_id = '00000000-0000-4000-8000-0000000000e1'
  and action in ('admin.business_updated', 'admin.subscription_updated')), 2, 'both edits audited');
select is((select diff -> 'before' ->> 'status' from public.audit_logs where tenant_id = '00000000-0000-4000-8000-0000000000e1'
  and action = 'admin.subscription_updated'), 'trialing', 'the audit keeps what it was before');

select * from finish();
rollback;
