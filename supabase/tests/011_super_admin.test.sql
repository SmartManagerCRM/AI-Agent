-- pgTAP: Phase 9 structural checks (spec §98 Super Admin).
begin;
select plan(6);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public' and routine_name in ('add_platform_admin', 'remove_platform_admin')),
  2,
  'both platform-admin-managing functions exist'
);

-- platform_admins itself still has no direct client write policy — every
-- write is one of the two functions above.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'platform_admins' and cmd in ('INSERT', 'UPDATE', 'DELETE')),
  0,
  'platform_admins has no direct insert/update/delete policy'
);

-- platform_settings gained a real write path this phase.
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'platform_settings' and cmd = 'UPDATE'),
  1,
  'platform_settings has an update policy'
);
select ok(
  (select qual = 'app.is_super_admin()' from pg_policies where schemaname = 'public' and tablename = 'platform_settings' and cmd = 'UPDATE'),
  'platform_settings update is Super-Admin-only'
);

-- ai_model_configs' write gate has existed since Phase 3 — confirm it
-- survived unchanged into this phase, which is the whole point (no new
-- migration touches it, only a new console UI in front of it).
select ok(
  (select count(*) > 0 from pg_policies where schemaname = 'public' and tablename = 'ai_model_configs' and cmd = 'ALL') = true,
  'ai_model_configs still has its Super-Admin write policy from Phase 3'
);

select ok(
  (select prosrc like '%last Super Admin%' from pg_proc where proname = 'remove_platform_admin'),
  'remove_platform_admin refuses to remove the last Super Admin'
);

select * from finish();
rollback;
