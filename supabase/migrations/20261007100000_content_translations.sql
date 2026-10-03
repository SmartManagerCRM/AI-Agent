-- Automatic translation of what owners and the Super Admin write (names,
-- descriptions, announcements) into the other supported languages.
--
--   * translation_queue      — a row is queued whenever one of its texts is
--                              added or changed (triggers below); the app
--                              translates it in the background.
--   * content_translations   — which language of which text was filled in
--                              automatically (and from what). A value someone
--                              typed is never in here — so it is never
--                              overwritten; an automatic one whose source text
--                              changed is translated again.
--   * translation_usage      — characters sent to each translation service per
--                              calendar month (UTC), so the free allowances are
--                              never exceeded.
--
-- No AI is involved: a built-in word list, then machine-translation services
-- (src/server/translate). Nothing here is visible to customers.

-- Announcements were a single text: keep it as the original, add its language
-- and the translations next to it.
alter table public.platform_announcements
  add column message_locale text not null default 'en' check (message_locale in ('en', 'ar', 'fr')),
  add column message_translations jsonb not null default '{}'::jsonb;

create table public.translation_queue (
  table_name text not null,
  row_key text not null,
  tenant_id uuid references public.tenants (id) on delete cascade,
  queued_at timestamptz not null default now(),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  primary key (table_name, row_key)
);
create index translation_queue_due_idx on public.translation_queue (next_attempt_at);

create table public.content_translations (
  table_name text not null,
  row_key text not null,
  field text not null,
  lang text not null check (lang in ('en', 'ar', 'fr')),
  tenant_id uuid references public.tenants (id) on delete cascade,
  source_lang text not null check (source_lang in ('en', 'ar', 'fr')),
  source_hash text not null,
  value text not null,
  provider text not null,
  translated_at timestamptz not null default now(),
  primary key (table_name, row_key, field, lang)
);
create index content_translations_tenant_idx on public.content_translations (tenant_id);

create table public.translation_usage (
  provider text not null,
  period date not null,
  characters bigint not null default 0,
  requests integer not null default 0,
  exhausted_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (provider, period)
);

alter table public.translation_queue enable row level security;
alter table public.translation_queue force row level security;
alter table public.content_translations enable row level security;
alter table public.content_translations force row level security;
alter table public.translation_usage enable row level security;
alter table public.translation_usage force row level security;

-- The queue is the server's own (service role only). Members see which of
-- their business's texts were translated automatically; the Super Admin sees
-- the platform's and the usage figures.
create policy content_translations_select on public.content_translations
  for select using (
    case when tenant_id is null then app.is_super_admin() else app.has_permission(tenant_id, 'catalog.read') or app.is_super_admin() end
  );
create policy translation_usage_select on public.translation_usage
  for select using (app.is_super_admin());

revoke all on public.translation_queue from anon, authenticated;
revoke all on public.content_translations from anon;
revoke insert, update, delete on public.content_translations from authenticated;
revoke all on public.translation_usage from anon;
revoke insert, update, delete on public.translation_usage from authenticated;
grant select on public.content_translations, public.translation_usage to authenticated;

-- ── Queueing ──────────────────────────────────────────────────────────────
-- Arguments: the key column, the tenant column ('' for platform tables), then
-- the columns holding text to translate. Writes made by the translator itself
-- (app.translating = on) don't queue the row again.
create or replace function app.queue_translation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_changed boolean := tg_op = 'INSERT';
  i integer;
begin
  if coalesce(current_setting('app.translating', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    for i in 2 .. tg_nargs - 1 loop
      if (v_new -> tg_argv[i]) is distinct from (v_old -> tg_argv[i]) then
        v_changed := true;
      end if;
    end loop;
  end if;
  if not v_changed then
    return new;
  end if;
  insert into public.translation_queue (table_name, row_key, tenant_id)
  values (tg_table_name, v_new ->> tg_argv[0], case when tg_argv[1] <> '' then (v_new ->> tg_argv[1])::uuid end)
  on conflict (table_name, row_key) do update
    set queued_at = now(), attempts = 0, next_attempt_at = now(), locked_until = null;
  return new;
end;
$$;

create trigger queue_translation after insert or update on public.products
  for each row execute function app.queue_translation('id', 'tenant_id', 'name', 'description');
create trigger queue_translation after insert or update on public.categories
  for each row execute function app.queue_translation('id', 'tenant_id', 'name');
create trigger queue_translation after insert or update on public.bookable_services
  for each row execute function app.queue_translation('id', 'tenant_id', 'name', 'description');
create trigger queue_translation after insert or update on public.membership_plans
  for each row execute function app.queue_translation('id', 'tenant_id', 'name', 'description');
create trigger queue_translation after insert or update on public.subscription_plans
  for each row execute function app.queue_translation('key', '', 'name');
create trigger queue_translation after insert or update on public.business_types
  for each row execute function app.queue_translation('key', '', 'name');
create trigger queue_translation after insert or update on public.platform_announcements
  for each row execute function app.queue_translation('id', '', 'message', 'message_locale', 'message_translations');

-- What may be translated: table → key column and translatable columns.
create or replace function app.translatable_column(p_table text, p_field text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table in ('products', 'bookable_services', 'membership_plans') and p_field in ('name', 'description') then 'id'
    when p_table = 'categories' and p_field = 'name' then 'id'
    when p_table in ('subscription_plans', 'business_types') and p_field = 'name' then 'key'
    when p_table = 'platform_announcements' and p_field = 'message_translations' then 'id'
  end;
$$;

-- ── Worker functions (service role only) ─────────────────────────────────
-- Claims due rows for a few minutes (other servers skip them meanwhile).
create or replace function public.claim_translation_jobs(p_limit integer)
returns setof public.translation_queue
language sql
security definer
set search_path = ''
as $$
  update public.translation_queue q
     set locked_until = now() + interval '5 minutes', attempts = q.attempts + 1
   where (q.table_name, q.row_key) in (
     select c.table_name, c.row_key from public.translation_queue c
      where c.next_attempt_at <= now() and (c.locked_until is null or c.locked_until < now())
      order by c.queued_at
      limit greatest(1, least(p_limit, 100))
      for update skip locked)
  returning q.*;
$$;

-- Done: removed, unless the row was changed again meanwhile (then it stays queued).
create or replace function public.finish_translation_job(p_table text, p_key text, p_queued_at timestamptz, p_retry_in_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_retry_in_seconds is null then
    delete from public.translation_queue where table_name = p_table and row_key = p_key and queued_at = p_queued_at;
    update public.translation_queue set locked_until = null where table_name = p_table and row_key = p_key;
  else
    update public.translation_queue
       set locked_until = null, next_attempt_at = now() + make_interval(secs => greatest(p_retry_in_seconds, 30))
     where table_name = p_table and row_key = p_key;
  end if;
end;
$$;

-- Writes one translated value — only into a language that is still empty, or
-- still holds the automatic value this translator wrote before (p_expected).
-- Anything a person typed meanwhile is left alone. Returns whether it wrote.
create or replace function public.apply_content_translation(
  p_table text, p_key text, p_field text, p_lang text, p_value text, p_expected text,
  p_source_lang text, p_source_hash text, p_provider text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key_column text := app.translatable_column(p_table, p_field);
  v_tenant uuid;
  v_count integer;
begin
  if v_key_column is null then
    raise exception 'VALIDATION_ERROR: % is not translatable', p_table || '.' || p_field;
  end if;
  if p_lang not in ('en', 'ar', 'fr') or p_source_lang not in ('en', 'ar', 'fr') or p_lang = p_source_lang then
    raise exception 'VALIDATION_ERROR: invalid language';
  end if;
  if coalesce(trim(p_value), '') = '' then
    return false;
  end if;
  perform set_config('app.translating', 'on', true);
  execute format(
    'update public.%I set %I = coalesce(%I, ''{}''::jsonb) || jsonb_build_object($1, $2)
      where %I::text = $3 and (coalesce(%I, ''{}''::jsonb) ->> $1) is not distinct from $4',
    p_table, p_field, p_field, v_key_column, p_field)
    using p_lang, p_value, p_key, p_expected;
  get diagnostics v_count = row_count;
  perform set_config('app.translating', 'off', true);
  if v_count = 0 then
    return false;
  end if;
  if p_table in ('products', 'categories', 'bookable_services', 'membership_plans') then
    execute format('select tenant_id from public.%I where id::text = $1', p_table) into v_tenant using p_key;
  end if;
  insert into public.content_translations (table_name, row_key, field, lang, tenant_id, source_lang, source_hash, value, provider)
  values (p_table, p_key, p_field, p_lang, v_tenant, p_source_lang, p_source_hash, p_value, p_provider)
  on conflict (table_name, row_key, field, lang) do update
    set source_lang = excluded.source_lang, source_hash = excluded.source_hash, value = excluded.value,
        provider = excluded.provider, translated_at = now(), tenant_id = excluded.tenant_id;
  return true;
end;
$$;

-- Counts characters against a service's monthly allowance before a request.
-- False (nothing counted) when it would go over p_limit, or when the service
-- already said its allowance is used up this month.
create or replace function public.reserve_translation_characters(p_provider text, p_characters integer, p_limit bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'utc')::date;
  v_row public.translation_usage%rowtype;
begin
  insert into public.translation_usage (provider, period) values (p_provider, v_period) on conflict do nothing;
  select * into v_row from public.translation_usage where provider = p_provider and period = v_period for update;
  if v_row.exhausted_at is not null then
    return false;
  end if;
  if p_limit is not null and v_row.characters + p_characters > p_limit then
    return false;
  end if;
  update public.translation_usage
     set characters = characters + greatest(p_characters, 0), requests = requests + 1, updated_at = now()
   where provider = p_provider and period = v_period;
  return true;
end;
$$;

-- A request that failed gives its characters back; a service that answered
-- "allowance used up" is skipped for the rest of the month.
create or replace function public.settle_translation_characters(p_provider text, p_refund integer, p_exhausted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period date := date_trunc('month', now() at time zone 'utc')::date;
begin
  update public.translation_usage
     set characters = greatest(characters - greatest(p_refund, 0), 0),
         exhausted_at = case when p_exhausted then coalesce(exhausted_at, now()) else exhausted_at end,
         updated_at = now()
   where provider = p_provider and period = v_period;
end;
$$;

-- Super Admin "Translate missing": queue every row that has a translatable
-- text, so the worker fills in whatever is missing (rows with nothing missing
-- are simply dropped again). Returns how many rows were queued.
create or replace function public.queue_all_translations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app.is_super_admin() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'PERMISSION_ERROR: Super Admin required' using errcode = '42501';
  end if;
  insert into public.translation_queue (table_name, row_key, tenant_id)
  select 'products', id::text, tenant_id from public.products
  union all select 'categories', id::text, tenant_id from public.categories
  union all select 'bookable_services', id::text, tenant_id from public.bookable_services
  union all select 'membership_plans', id::text, tenant_id from public.membership_plans
  union all select 'subscription_plans', key, null from public.subscription_plans
  union all select 'business_types', key, null from public.business_types
  union all select 'platform_announcements', id::text, null from public.platform_announcements where is_active
  on conflict (table_name, row_key) do update set next_attempt_at = now(), attempts = 0, locked_until = null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.claim_translation_jobs(integer) from public, anon, authenticated;
revoke all on function public.finish_translation_job(text, text, timestamptz, integer) from public, anon, authenticated;
revoke all on function public.apply_content_translation(text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.reserve_translation_characters(text, integer, bigint) from public, anon, authenticated;
revoke all on function public.settle_translation_characters(text, integer, boolean) from public, anon, authenticated;
revoke all on function public.queue_all_translations() from public, anon;
grant execute on function public.claim_translation_jobs(integer) to service_role;
grant execute on function public.finish_translation_job(text, text, timestamptz, integer) to service_role;
grant execute on function public.apply_content_translation(text, text, text, text, text, text, text, text, text) to service_role;
grant execute on function public.reserve_translation_characters(text, integer, bigint) to service_role;
grant execute on function public.settle_translation_characters(text, integer, boolean) to service_role;
grant execute on function public.queue_all_translations() to authenticated, service_role;
revoke all on function app.queue_translation() from public, anon, authenticated;
