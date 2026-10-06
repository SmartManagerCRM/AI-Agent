-- Super Admin can delete announcements (they could already add and edit
-- them). Only a Super Admin: subscribers still only read the active ones.
-- A deleted announcement's automatic translations and any pending
-- translation work for it go with it.

create policy platform_announcements_delete on public.platform_announcements
  for delete using (app.is_super_admin());

create or replace function app.forget_announcement_translations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.content_translations where table_name = 'platform_announcements' and row_key = old.id::text;
  delete from public.translation_queue where table_name = 'platform_announcements' and row_key = old.id::text;
  return old;
end;
$$;
revoke all on function app.forget_announcement_translations() from public, anon, authenticated;

create trigger forget_announcement_translations
  after delete on public.platform_announcements
  for each row execute function app.forget_announcement_translations();
