-- pgTAP: deleting announcements — Super Admin only; their translations go with them.
begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000f36a1', 'ann-admin@test.local'),
  ('00000000-0000-4000-8000-0000000f36a2', 'ann-owner@test.local');
insert into public.platform_admins (user_id) values ('00000000-0000-4000-8000-0000000f36a1');
insert into public.platform_announcements (id, message, message_locale, message_translations, severity, created_by) values
  ('00000000-0000-4000-8000-0000000f36c1', 'Maintenance tonight', 'en', '{"fr":"Maintenance ce soir","ar":"صيانة الليلة"}', 'info', '00000000-0000-4000-8000-0000000f36a1');
insert into public.content_translations (table_name, row_key, field, lang, source_lang, source_hash, value, provider)
values ('platform_announcements', '00000000-0000-4000-8000-0000000f36c1', 'message_translations', 'fr', 'en', 'h', 'Maintenance ce soir', 'azure_free');
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'tap') then
    execute 'grant usage on schema tap to authenticated, service_role, anon';
    execute 'grant execute on all functions in schema tap to authenticated, service_role, anon';
  end if;
end $$;

-- A subscriber can't delete it (the row is simply not theirs to remove).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f36a2","role":"authenticated"}';
delete from public.platform_announcements where id = '00000000-0000-4000-8000-0000000f36c1';
reset role;
select is((select count(*)::int from public.platform_announcements where id = '00000000-0000-4000-8000-0000000f36c1'), 1,
  'a subscriber cannot delete an announcement');

-- The Super Admin edits it, then deletes it.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000f36a1","role":"authenticated"}';
update public.platform_announcements set message = 'Maintenance tonight at 2am', severity = 'warning' where id = '00000000-0000-4000-8000-0000000f36c1';
select is((select severity from public.platform_announcements where id = '00000000-0000-4000-8000-0000000f36c1'), 'warning', 'the Super Admin edits it');
delete from public.platform_announcements where id = '00000000-0000-4000-8000-0000000f36c1';
reset role;
select is((select count(*)::int from public.platform_announcements where id = '00000000-0000-4000-8000-0000000f36c1'), 0, 'the Super Admin deletes it');
select is((select count(*)::int from public.content_translations where table_name = 'platform_announcements' and row_key = '00000000-0000-4000-8000-0000000f36c1'), 0,
  'its automatic translations go with it');
select is((select count(*)::int from public.translation_queue where table_name = 'platform_announcements' and row_key = '00000000-0000-4000-8000-0000000f36c1'), 0,
  'and so does any pending translation work');

select * from finish();
rollback;
