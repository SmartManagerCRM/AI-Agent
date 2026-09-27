-- pgTAP: multi-source Business Brain addendum structural checks.
begin;
select plan(8);

select has_table('public', 'business_brain_conflicts', 'business_brain_conflicts table exists');
select has_column('public', 'business_sources', 'source_type', 'business_sources.source_type exists (renamed from kind)');
select has_column('public', 'business_sources', 'scan_frequency', 'business_sources.scan_frequency exists');
select has_column('public', 'business_sources', 'content_hash', 'business_sources.content_hash exists');
select has_column('public', 'business_brain_entries', 'confidence', 'business_brain_entries.confidence exists');
select has_column('public', 'business_brain_entries', 'source_url', 'business_brain_entries.source_url exists');
select has_column('public', 'tenants', 'deployment_mode', 'tenants.deployment_mode exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.business_brain_conflicts'::regclass),
  'RLS is enabled and forced on business_brain_conflicts'
);

select * from finish();
rollback;
