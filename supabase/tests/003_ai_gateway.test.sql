-- pgTAP: Phase 3 structural checks (spec §5, §6, §29, §68, §69).
begin;
select plan(7);

select has_table('public', 'ai_model_configs', 'ai_model_configs table exists');
select has_table('public', 'agent_interactions', 'agent_interactions table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.agent_interactions'::regclass),
  'RLS is enabled and forced on agent_interactions'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'agent_interactions'
     and cmd in ('insert', 'update', 'delete')),
  0,
  'agent_interactions has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from public.ai_model_configs where is_active),
  (select count(*)::int from public.ai_model_configs where is_active and provider = 'gemini'),
  'every seeded active model config is Gemini (the paid-tier primary provider)'
);

select is(
  (select count(*)::int from public.ai_model_configs where is_default),
  2,
  'exactly one default row per kind (fast, agent) is seeded'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('record_agent_interaction', 'agent_interaction_stats')),
  2,
  'both AI gateway functions exist'
);

select * from finish();
rollback;
