-- pgTAP: tenant_ai_spend — one business's AI spend since a date, summed in the database.
begin;
select plan(5);

insert into public.tenants (id, slug, business_name, business_type_key, status, currency, timezone) values
  ('00000000-0000-4000-8000-0000000b41a1', 'spend-one', '{"en":"Spend One"}', 'restaurant', 'active', 'USD', 'UTC'),
  ('00000000-0000-4000-8000-0000000b41a2', 'spend-two', '{"en":"Spend Two"}', 'restaurant', 'active', 'USD', 'UTC');
-- 1500 interactions for business one this month (more than one API page), one last month, one for business two.
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, estimated_cost_usd, created_at)
select '00000000-0000-4000-8000-0000000b41a1', 'chat', 'ai', 'gemini', 'gemini-3.5-flash-lite', 0.002, now() from generate_series(1, 1500);
insert into public.agent_interactions (tenant_id, request_type, handled_by, provider, model, estimated_cost_usd, created_at) values
  ('00000000-0000-4000-8000-0000000b41a1', 'chat', 'ai', 'gemini', 'gemini-3.5-flash-lite', 5, now() - interval '40 days'),
  ('00000000-0000-4000-8000-0000000b41a2', 'chat', 'ai', 'gemini', 'gemini-3.5-flash-lite', 7, now());
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.tenant_ai_spend('00000000-0000-4000-8000-0000000b41a1', now() - interval '1 day'), 3.000::numeric,
  'every interaction counts, however many (1500 × 0.002)');
select is(public.tenant_ai_spend('00000000-0000-4000-8000-0000000b41a1', now() - interval '60 days'), 8.000::numeric,
  '… only since the given time');
select is(public.tenant_ai_spend('00000000-0000-4000-8000-0000000b41a2', now() - interval '1 day'), 7::numeric,
  '… and only that business''s');
reset role;
set local role authenticated;
select throws_ok($$ select public.tenant_ai_spend('00000000-0000-4000-8000-0000000b41a1', now()) $$, '42501', null,
  'signed-in users cannot call it');
reset role;
set local role anon;
select throws_ok($$ select public.tenant_ai_spend('00000000-0000-4000-8000-0000000b41a1', now()) $$, '42501', null,
  '… nor anonymous visitors');
reset role;

select * from finish();
rollback;
