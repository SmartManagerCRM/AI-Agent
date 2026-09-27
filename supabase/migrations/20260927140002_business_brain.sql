-- Phase 2 — Business Brain. The reviewed-knowledge side (spec §8–§11):
-- unstructured/semi-structured facts (about, policies, FAQs, promotions,
-- agent instructions, terminology, delivery/pickup/payment notes) that come
-- from an admin directly or from a crawled website, each versioned and
-- gated behind an approve/reject workflow before it counts as active
-- knowledge. `brain.read`/`brain.write` permissions already exist (Phase 1).

create table public.business_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null check (kind in ('website', 'manual')),
  url text,
  status text not null default 'pending' check (status in ('pending', 'crawling', 'completed', 'failed', 'disabled')),
  pages_crawled integer not null default 0,
  error_message text,
  is_active boolean not null default true,
  last_crawled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint business_sources_website_has_url check (kind <> 'website' or url is not null)
);
create trigger set_updated_at before update on public.business_sources
  for each row execute function app.set_updated_at();
create index business_sources_tenant_idx on public.business_sources (tenant_id);
alter table public.business_sources add constraint business_sources_tenant_id_uidx unique (tenant_id, id);

alter table public.business_sources enable row level security;
alter table public.business_sources force row level security;
create policy business_sources_select on public.business_sources
  for select using (app.has_permission(tenant_id, 'brain.read'));
create policy business_sources_insert on public.business_sources
  for insert with check (app.has_permission(tenant_id, 'brain.write'));
create policy business_sources_update on public.business_sources
  for update using (app.has_permission(tenant_id, 'brain.write'))
  with check (app.has_permission(tenant_id, 'brain.write'));
-- No delete policy: a source (and its crawl history) is deactivated
-- (is_active = false), never removed, so entries that cite it stay traceable.

-- ── Reviewed knowledge entries ───────────────────────────────────────────
create table public.business_brain_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_type text not null check (entry_type in (
    'about', 'policy', 'faq', 'promotion', 'instruction',
    'terminology', 'delivery_info', 'pickup_info', 'payment_methods', 'contact_note', 'raw_page'
  )),
  -- Logical identity a version history is grouped under, e.g. "about",
  -- "faq-do-you-deliver", or a per-crawled-page key. Chosen by the app, not
  -- the caller, except when an admin explicitly edits an existing key.
  entry_key text not null,
  content jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status text not null default 'pending_review' check (
    status in ('pending_review', 'approved', 'rejected', 'superseded', 'archived')
  ),
  is_active boolean not null default true,
  source text not null check (source in ('admin', 'website')),
  source_id uuid references public.business_sources(id) on delete set null,
  rejection_reason text,
  created_by uuid references auth.users(id) on delete set null,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.business_brain_entries
  for each row execute function app.set_updated_at();
create index business_brain_entries_tenant_idx on public.business_brain_entries (tenant_id, entry_type);
create index business_brain_entries_key_idx on public.business_brain_entries (tenant_id, entry_key, version desc);
-- At most one "live" row per (tenant, key) in each of these two states —
-- a new crawl/edit proposes a second `pending_review` row alongside the
-- still-active `approved` one; approving it supersedes the old one (see
-- `approve_brain_entry` below), so these two can briefly coexist by design.
create unique index business_brain_entries_approved_uidx
  on public.business_brain_entries (tenant_id, entry_key) where status = 'approved';
create unique index business_brain_entries_pending_uidx
  on public.business_brain_entries (tenant_id, entry_key) where status = 'pending_review';

alter table public.business_brain_entries enable row level security;
alter table public.business_brain_entries force row level security;
create policy business_brain_entries_select on public.business_brain_entries
  for select using (app.has_permission(tenant_id, 'brain.read'));
-- No insert/update/delete policy at all: every write goes through one of the
-- SECURITY DEFINER functions below, which re-check `brain.write` themselves
-- and stamp created_by/approved_by/approved_at/version — none of which a
-- client (or the crawler) is trusted to set correctly on its own.

-- ── Writes (all SECURITY DEFINER, all re-check has_permission themselves) ──

create or replace function public.create_brain_entry(
  p_tenant_id uuid,
  p_entry_type text,
  p_entry_key text,
  p_content jsonb,
  p_source text,
  p_source_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_status text;
  v_next_version int;
begin
  if not app.has_permission(p_tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if p_source not in ('admin', 'website') then
    raise exception 'VALIDATION_ERROR: invalid source';
  end if;

  -- Source priority (spec §10): an admin's own entry is authoritative
  -- immediately; anything the crawler proposes waits for review.
  v_status := case when p_source = 'admin' then 'approved' else 'pending_review' end;

  -- A fresh crawl re-proposing the same key (e.g. a recrawled page) replaces
  -- whatever earlier proposal was still awaiting review, rather than
  -- colliding with the partial unique index on (tenant_id, entry_key) where
  -- status = 'pending_review'.
  update public.business_brain_entries
    set status = 'superseded'
    where tenant_id = p_tenant_id and entry_key = p_entry_key and status = 'pending_review';

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.business_brain_entries
  where tenant_id = p_tenant_id and entry_key = p_entry_key;

  insert into public.business_brain_entries (
    tenant_id, entry_type, entry_key, content, version, status, source, source_id,
    created_by, approved_by, approved_at
  ) values (
    p_tenant_id, p_entry_type, p_entry_key, p_content, v_next_version, v_status, p_source, p_source_id,
    auth.uid(), case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end
  )
  returning id into v_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, auth.uid(), 'brain_entry.created', 'business_brain_entry', v_id);

  return v_id;
end;
$$;
revoke all on function public.create_brain_entry(uuid, text, text, jsonb, text, uuid) from public;
grant execute on function public.create_brain_entry(uuid, text, text, jsonb, text, uuid) to authenticated;

create or replace function public.update_brain_entry(p_entry_id uuid, p_content jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_brain_entries%rowtype;
  v_new_id uuid;
begin
  select * into v_row from public.business_brain_entries where id = p_entry_id;
  if not found then
    raise exception 'NOT_FOUND: entry does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if v_row.status not in ('approved', 'pending_review') then
    raise exception 'VALIDATION_ERROR: only an approved or pending entry can be edited';
  end if;

  update public.business_brain_entries set status = 'superseded' where id = p_entry_id;

  -- An admin editing directly is itself the top-priority source (spec §10),
  -- so the edited version is approved immediately regardless of where the
  -- superseded version came from.
  insert into public.business_brain_entries (
    tenant_id, entry_type, entry_key, content, version, status, source, source_id,
    created_by, approved_by, approved_at
  ) values (
    v_row.tenant_id, v_row.entry_type, v_row.entry_key, p_content, v_row.version + 1, 'approved', 'admin', null,
    auth.uid(), auth.uid(), now()
  )
  returning id into v_new_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'brain_entry.updated', 'business_brain_entry', v_new_id,
    jsonb_build_object('previous_entry_id', v_row.id));

  return v_new_id;
end;
$$;
revoke all on function public.update_brain_entry(uuid, jsonb) from public;
grant execute on function public.update_brain_entry(uuid, jsonb) to authenticated;

create or replace function public.approve_brain_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_brain_entries%rowtype;
begin
  select * into v_row from public.business_brain_entries where id = p_entry_id;
  if not found then
    raise exception 'NOT_FOUND: entry does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'VALIDATION_ERROR: only a pending entry can be approved';
  end if;

  -- Approving a new version supersedes whatever was previously approved
  -- under the same key (there can be at most one, per the partial unique
  -- index above).
  update public.business_brain_entries
    set status = 'superseded'
    where tenant_id = v_row.tenant_id and entry_key = v_row.entry_key and status = 'approved';

  update public.business_brain_entries
    set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_row.tenant_id, auth.uid(), 'brain_entry.approved', 'business_brain_entry', p_entry_id);
end;
$$;
revoke all on function public.approve_brain_entry(uuid) from public;
grant execute on function public.approve_brain_entry(uuid) to authenticated;

create or replace function public.reject_brain_entry(p_entry_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_brain_entries%rowtype;
begin
  select * into v_row from public.business_brain_entries where id = p_entry_id;
  if not found then
    raise exception 'NOT_FOUND: entry does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if v_row.status <> 'pending_review' then
    raise exception 'VALIDATION_ERROR: only a pending entry can be rejected';
  end if;

  update public.business_brain_entries
    set status = 'rejected', rejection_reason = p_reason
    where id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'brain_entry.rejected', 'business_brain_entry', p_entry_id,
    jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.reject_brain_entry(uuid, text) from public;
grant execute on function public.reject_brain_entry(uuid, text) to authenticated;

create or replace function public.set_brain_entry_active(p_entry_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_brain_entries%rowtype;
begin
  select * into v_row from public.business_brain_entries where id = p_entry_id;
  if not found then
    raise exception 'NOT_FOUND: entry does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;

  update public.business_brain_entries set is_active = p_active where id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(),
    case when p_active then 'brain_entry.activated' else 'brain_entry.deactivated' end,
    'business_brain_entry', p_entry_id, jsonb_build_object('is_active', p_active));
end;
$$;
revoke all on function public.set_brain_entry_active(uuid, boolean) from public;
grant execute on function public.set_brain_entry_active(uuid, boolean) to authenticated;
