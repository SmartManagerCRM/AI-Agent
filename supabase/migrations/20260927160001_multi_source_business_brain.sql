-- Multi-source Business Brain addendum — CRITICAL ARCHITECTURE ADDENDUM:
-- the Business Brain (and the Agent built on it) must not depend on a
-- website. Website crawling (Phase 2) was the first connector implemented;
-- this migration generalizes the schema so Instagram/Facebook/online-menu/
-- PDF/document/image/Google-Business/API connectors can be added later
-- "without redesigning the Business Brain" — none of those connectors are
-- implemented yet (only `website` and `manual`), but the vocabulary and the
-- conflict-tracking mechanism exist now so adding one is additive.

-- ── business_sources: generalize from "website crawl" to "any source" ───
alter table public.business_sources rename column kind to source_type;
alter table public.business_sources rename column last_crawled_at to last_scanned_at;
alter table public.business_sources rename column pages_crawled to items_processed;

alter table public.business_sources drop constraint business_sources_kind_check;
alter table public.business_sources add constraint business_sources_source_type_check check (
  source_type in (
    'website', 'instagram', 'facebook', 'online_menu', 'pdf', 'document',
    'image', 'google_business', 'manual', 'api'
  )
);

alter table public.business_sources drop constraint business_sources_website_has_url;
alter table public.business_sources add constraint business_sources_website_has_url check (
  source_type <> 'website' or url is not null
);

alter table public.business_sources
  add column scan_frequency text not null default 'manual' check (scan_frequency in ('manual', 'daily', 'weekly')),
  add column content_hash text,
  -- Whether ingested content has been turned into structured entities yet.
  -- Today's connectors (website/manual) only ever reach 'raw_only' — turning
  -- crawled text into structured product/branch drafts needs the AI Gateway
  -- reasoning a future phase adds; this column exists so that phase has
  -- somewhere to record progress without another migration.
  add column extraction_status text not null default 'raw_only' check (extraction_status in ('raw_only', 'partial', 'structured'));

-- ── business_brain_entries: same source vocabulary, plus confidence and
--    direct traceability (spec addendum §24: source/value/confidence/
--    detected_at/last-verified per fact) ─────────────────────────────────
alter table public.business_brain_entries rename column source to source_type;
alter table public.business_brain_entries drop constraint business_brain_entries_source_check;
alter table public.business_brain_entries add constraint business_brain_entries_source_type_check check (
  source_type in (
    'website', 'instagram', 'facebook', 'online_menu', 'pdf', 'document',
    'image', 'google_business', 'manual', 'api'
  )
);

alter table public.business_brain_entries
  add column confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  add column source_url text,
  add column last_verified_at timestamptz;

-- ── Source conflict tracking (addendum §6: "Detect and record conflicts.
--    Never silently choose an arbitrary value.") ────────────────────────
create table public.business_brain_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_key text not null,
  entry_type text not null,
  -- Array of { source_type, source_id, value, confidence, detected_at } —
  -- every disagreeing value seen for this key, not just the latest pair.
  conflicting_values jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_value jsonb,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index business_brain_conflicts_tenant_idx on public.business_brain_conflicts (tenant_id, status);

alter table public.business_brain_conflicts enable row level security;
alter table public.business_brain_conflicts force row level security;
create policy business_brain_conflicts_select on public.business_brain_conflicts
  for select using (app.has_permission(tenant_id, 'brain.read'));
-- No insert/update/delete policy: conflicts are detected and inserted by
-- `create_brain_entry` itself, and resolved by `resolve_brain_conflict`
-- below — never written directly by a client.

create or replace function public.resolve_brain_conflict(p_conflict_id uuid, p_resolved_value jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.business_brain_conflicts%rowtype;
begin
  select * into v_row from public.business_brain_conflicts where id = p_conflict_id;
  if not found then
    raise exception 'NOT_FOUND: conflict does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if v_row.status <> 'open' then
    raise exception 'VALIDATION_ERROR: only an open conflict can be resolved';
  end if;

  update public.business_brain_conflicts
    set status = 'resolved', resolved_value = p_resolved_value, resolved_by = auth.uid(), resolved_at = now()
    where id = p_conflict_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'brain_conflict.resolved', 'business_brain_conflict', p_conflict_id,
    jsonb_build_object('resolved_value', p_resolved_value));
end;
$$;
revoke all on function public.resolve_brain_conflict(uuid, jsonb) from public;
grant execute on function public.resolve_brain_conflict(uuid, jsonb) to authenticated;

-- ── create_brain_entry: full source vocabulary, per-source confidence
--    default, and conflict detection/handling against an existing approved
--    fact under the same key ─────────────────────────────────────────────
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
  v_confidence text;
  v_next_version int;
  v_existing_approved public.business_brain_entries%rowtype;
begin
  if not app.has_permission(p_tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if p_source not in ('website', 'instagram', 'facebook', 'online_menu', 'pdf', 'document', 'image', 'google_business', 'manual', 'api') then
    raise exception 'VALIDATION_ERROR: invalid source';
  end if;

  -- Source priority (addendum §6, spec §10): an owner/staff entry (or edit)
  -- is authoritative immediately; every ingested source waits for review.
  -- Confidence follows the same priority — social content is explicitly
  -- lower-confidence than owner-confirmed or first-party data (addendum §8).
  v_status := case when p_source = 'manual' then 'approved' else 'pending_review' end;
  v_confidence := case
    when p_source = 'manual' then 'high'
    when p_source in ('instagram', 'facebook', 'image') then 'low'
    else 'medium'
  end;

  select * into v_existing_approved
  from public.business_brain_entries
  where tenant_id = p_tenant_id and entry_key = p_entry_key and status = 'approved';

  -- Two different sources disagreeing on the same fact is never resolved
  -- silently (addendum §6) — record it regardless of which path below
  -- ends up storing the new value.
  if v_existing_approved.id is not null
     and v_existing_approved.source_type <> p_source
     and v_existing_approved.content is distinct from p_content then
    insert into public.business_brain_conflicts (tenant_id, entry_key, entry_type, conflicting_values)
    values (
      p_tenant_id, p_entry_key, p_entry_type,
      jsonb_build_array(
        jsonb_build_object(
          'source_type', v_existing_approved.source_type, 'source_id', v_existing_approved.source_id,
          'value', v_existing_approved.content, 'confidence', v_existing_approved.confidence,
          'detected_at', coalesce(v_existing_approved.approved_at, v_existing_approved.created_at)
        ),
        jsonb_build_object(
          'source_type', p_source, 'source_id', p_source_id,
          'value', p_content, 'confidence', v_confidence, 'detected_at', now()
        )
      )
    );
  end if;

  -- An owner/staff entry always wins immediately, superseding whatever was
  -- approved before under the same key (this also keeps the partial unique
  -- index on (tenant_id, entry_key) where status = 'approved' satisfied —
  -- without this, a manual entry reusing an already-approved key would
  -- otherwise hit that constraint).
  if p_source = 'manual' and v_existing_approved.id is not null then
    update public.business_brain_entries set status = 'superseded' where id = v_existing_approved.id;
  end if;

  update public.business_brain_entries
    set status = 'superseded'
    where tenant_id = p_tenant_id and entry_key = p_entry_key and status = 'pending_review';

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.business_brain_entries
  where tenant_id = p_tenant_id and entry_key = p_entry_key;

  insert into public.business_brain_entries (
    tenant_id, entry_type, entry_key, content, version, status, source_type, source_id, confidence,
    created_by, approved_by, approved_at
  ) values (
    p_tenant_id, p_entry_type, p_entry_key, p_content, v_next_version, v_status, p_source, p_source_id, v_confidence,
    auth.uid(), case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end
  )
  returning id into v_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (p_tenant_id, auth.uid(), 'brain_entry.created', 'business_brain_entry', v_id);

  return v_id;
end;
$$;

-- ── update_brain_entry: an admin/staff edit is source_type = 'manual' now,
--    high confidence, and carries last_verified_at forward ──────────────
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

  insert into public.business_brain_entries (
    tenant_id, entry_type, entry_key, content, version, status, source_type, source_id, confidence,
    created_by, approved_by, approved_at, last_verified_at
  ) values (
    v_row.tenant_id, v_row.entry_type, v_row.entry_key, p_content, v_row.version + 1, 'approved', 'manual', null, 'high',
    auth.uid(), auth.uid(), now(), now()
  )
  returning id into v_new_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'brain_entry.updated', 'business_brain_entry', v_new_id,
    jsonb_build_object('previous_entry_id', v_row.id));

  return v_new_id;
end;
$$;

-- ── Deployment mode (addendum §15): whether the Agent is reached through
--    a website widget, the standalone external Agent page, or both. Default
--    is external_agent — the addendum's own critical rule is that the
--    Agent must work with NO WEBSITE, so that is the default a tenant
--    starts in, not an opt-in.
alter table public.tenants
  add column deployment_mode text not null default 'external_agent'
    check (deployment_mode in ('website_widget', 'external_agent', 'both'));
