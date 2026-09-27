-- pgTAP: Phase 1 foundation checks (spec §21, §84). Run with `npm run
-- test:db` (requires the local Supabase stack / Docker). Deeper
-- role-impersonation cross-tenant isolation tests (owner A cannot read
-- tenant B's rows, etc.) are a Phase 2+ follow-up, once there are child
-- tables (Business Brain) whose isolation is actually worth exercising
-- end to end — Phase 1 has only the tenant row itself and its own staff.
begin;
select plan(11);

select has_table('public', 'tenants', 'tenants table exists');
select has_table('public', 'tenant_members', 'tenant_members table exists');
select has_table('public', 'tenant_settings', 'tenant_settings table exists');
select has_table('public', 'audit_logs', 'audit_logs table exists');
select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'platform_admins', 'platform_admins table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tenants'::regclass),
  'RLS is enabled and forced on tenants'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.tenant_members'::regclass),
  'RLS is enabled and forced on tenant_members'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.audit_logs'::regclass),
  'RLS is enabled and forced on audit_logs'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.profiles'::regclass),
  'RLS is enabled and forced on profiles'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.platform_admins'::regclass),
  'RLS is enabled and forced on platform_admins'
);
select is(
  (select count(*)::int from public.roles where tenant_id is null),
  3,
  'the three system roles (business_owner, business_admin, staff) are seeded'
);

select * from finish();
rollback;
