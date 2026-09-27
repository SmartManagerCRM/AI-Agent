-- pgTAP: Phase 2 structural checks (spec §8–§11). Run with `npm run test:db`.
begin;
select plan(9);

select has_table('public', 'branches', 'branches table exists');
select has_table('public', 'categories', 'categories table exists');
select has_table('public', 'products', 'products table exists');
select has_table('public', 'business_sources', 'business_sources table exists');
select has_table('public', 'business_brain_entries', 'business_brain_entries table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.products'::regclass),
  'RLS is enabled and forced on products'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.business_brain_entries'::regclass),
  'RLS is enabled and forced on business_brain_entries'
);

-- No client-facing insert/update/delete policy exists on business_brain_entries
-- at all: every write must go through the SECURITY DEFINER functions.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'business_brain_entries'
     and cmd in ('insert', 'update', 'delete')),
  0,
  'business_brain_entries has no direct insert/update/delete policy'
);

select is(
  (select count(*)::int from information_schema.routines
   where routine_schema = 'public'
     and routine_name in ('create_brain_entry', 'update_brain_entry', 'approve_brain_entry', 'reject_brain_entry', 'set_brain_entry_active')),
  5,
  'all five Business Brain write functions exist'
);

select * from finish();
rollback;
