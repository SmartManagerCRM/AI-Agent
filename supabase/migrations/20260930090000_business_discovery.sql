-- Business Discovery Engine — extends the existing Business Brain (it does
-- not create a second one). Google Places becomes the first discovery
-- source; the existing website connector gains page discovery and
-- fingerprinting; every discovered fact keeps its provenance and waits for
-- owner review exactly like today's crawled facts.
--
-- Everything here is additive. RLS follows the existing Business Brain
-- pattern: read with `brain.read`, write with `brain.write`
-- (`app.has_permission` already lets Super Admin through).

-- ── Sources: identity, fingerprint and processing state ──────────────────
alter table public.business_sources
  -- Stable external identifier, e.g. the Google Place ID (Google permits
  -- storing Place IDs indefinitely; other Places content is not cached here).
  add column external_id text,
  add column processing_status text not null default 'new' check (
    processing_status in ('new', 'processing', 'processed', 'unchanged', 'changed', 'failed', 'blocked', 'requires_review')
  ),
  add column priority smallint not null default 50 check (priority between 0 and 100),
  add column last_fetched_at timestamptz,
  add column last_changed_at timestamptz,
  add column last_processed_at timestamptz,
  add column extraction_version text,
  -- Attribution the source requires when its content is shown (e.g. Google Maps).
  add column attribution jsonb;

create unique index business_sources_external_uidx
  on public.business_sources (tenant_id, source_type, external_id) where external_id is not null;

-- ── Facts: logical key + provenance ──────────────────────────────────────
alter table public.business_brain_entries drop constraint business_brain_entries_entry_type_check;
alter table public.business_brain_entries add constraint business_brain_entries_entry_type_check check (entry_type in (
  'about', 'policy', 'faq', 'promotion', 'instruction',
  'terminology', 'delivery_info', 'pickup_info', 'payment_methods', 'contact_note', 'raw_page',
  -- discovery facts
  'identity', 'business_type', 'location', 'contact', 'hours', 'capability', 'product_candidate', 'service_candidate'
));

alter table public.business_brain_entries
  -- The logical fact ("hours.regular", "contact.phone", ...). Each source
  -- proposes its own candidate under entry_key = fact_key || '@' || source,
  -- so candidates from different sources coexist and can be compared.
  add column fact_key text,
  add column confidence_score smallint check (confidence_score between 0 and 100),
  add column extraction_method text check (
    extraction_method in ('owner', 'structured_api', 'structured_data', 'deterministic', 'ai', 'inferred')
  ),
  add column extraction_model text,
  add column processing_version text,
  add column first_seen_at timestamptz,
  add column last_seen_at timestamptz,
  -- When an unconfirmed fact must be discarded (Google Places content may
  -- only be kept temporarily). Cleared when the owner confirms the fact.
  add column expires_at timestamptz,
  add column ingestion_job_id uuid;

create index business_brain_entries_fact_idx
  on public.business_brain_entries (tenant_id, fact_key) where fact_key is not null;

-- ── Ingestion jobs + timeline ────────────────────────────────────────────
create table public.brain_ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  trigger text not null default 'manual' check (trigger in ('onboarding', 'manual', 'refresh')),
  input jsonb not null default '{}'::jsonb,
  status text not null default 'created' check (status in (
    'created', 'discovering', 'fetching', 'extracting', 'ai_processing', 'normalizing', 'validating',
    'conflict_check', 'ready_for_review', 'completed', 'failed', 'paused', 'cancelled'
  )),
  status_reason text,
  place_id text,
  detected_business_type text,
  started_at timestamptz,
  completed_at timestamptz,
  sources_processed integer not null default 0,
  pages_processed integer not null default 0,
  documents_processed integer not null default 0,
  facts_proposed integer not null default 0,
  conflicts_detected integer not null default 0,
  ai_calls integer not null default 0,
  ai_input_tokens integer not null default 0,
  ai_output_tokens integer not null default 0,
  ai_cost_usd numeric(12, 6) not null default 0,
  google_calls integer not null default 0,
  google_cost_usd numeric(12, 6) not null default 0,
  budget_usd numeric(12, 6) not null default 0.10,
  warnings jsonb not null default '[]'::jsonb,
  errors jsonb not null default '[]'::jsonb,
  readiness jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.brain_ingestion_jobs
  for each row execute function app.set_updated_at();

-- One running analysis per business (a double click can't start two).
create unique index brain_ingestion_jobs_one_active_idx on public.brain_ingestion_jobs (tenant_id)
  where status in ('created', 'discovering', 'fetching', 'extracting', 'ai_processing', 'normalizing', 'validating', 'conflict_check');
create index brain_ingestion_jobs_tenant_idx on public.brain_ingestion_jobs (tenant_id, created_at desc);
create index brain_ingestion_jobs_created_idx on public.brain_ingestion_jobs (created_at desc);

alter table public.brain_ingestion_jobs enable row level security;
alter table public.brain_ingestion_jobs force row level security;
create policy brain_ingestion_jobs_select on public.brain_ingestion_jobs
  for select using (app.has_permission(tenant_id, 'brain.read'));
create policy brain_ingestion_jobs_insert on public.brain_ingestion_jobs
  for insert with check (app.has_permission(tenant_id, 'brain.write'));
create policy brain_ingestion_jobs_update on public.brain_ingestion_jobs
  for update using (app.has_permission(tenant_id, 'brain.write'))
  with check (app.has_permission(tenant_id, 'brain.write'));

alter table public.business_brain_entries
  add constraint business_brain_entries_job_fk
  foreign key (ingestion_job_id) references public.brain_ingestion_jobs(id) on delete set null;

create table public.brain_ingestion_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.brain_ingestion_jobs(id) on delete cascade,
  at timestamptz not null default now(),
  step text not null,
  level text not null default 'info' check (level in ('info', 'success', 'warning', 'error')),
  message text not null,
  data jsonb
);
create index brain_ingestion_events_job_idx on public.brain_ingestion_events (job_id, at);

alter table public.brain_ingestion_events enable row level security;
alter table public.brain_ingestion_events force row level security;
create policy brain_ingestion_events_select on public.brain_ingestion_events
  for select using (app.has_permission(tenant_id, 'brain.read'));
create policy brain_ingestion_events_insert on public.brain_ingestion_events
  for insert with check (app.has_permission(tenant_id, 'brain.write'));

-- ── Per-page/document fingerprints (dedup + incremental processing) ─────
create table public.brain_source_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source_id uuid not null references public.business_sources(id) on delete cascade,
  url text not null,
  canonical_url text not null,
  kind text not null default 'page' check (kind in ('page', 'document', 'image')),
  topic text,
  priority_score smallint not null default 0,
  title text,
  content_hash text,
  status text not null default 'new' check (
    status in ('new', 'processing', 'processed', 'unchanged', 'changed', 'failed', 'blocked', 'requires_review')
  ),
  extraction_version text,
  -- Cached extraction result for this exact content_hash: identical content
  -- is never re-extracted (and never re-sent to an AI model).
  extraction jsonb,
  error_message text,
  last_fetched_at timestamptz,
  last_changed_at timestamptz,
  last_processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brain_source_documents_canonical_uniq unique (tenant_id, canonical_url)
);
create trigger set_updated_at before update on public.brain_source_documents
  for each row execute function app.set_updated_at();
create index brain_source_documents_source_idx on public.brain_source_documents (source_id);
create index brain_source_documents_hash_idx on public.brain_source_documents (tenant_id, content_hash);

alter table public.brain_source_documents enable row level security;
alter table public.brain_source_documents force row level security;
create policy brain_source_documents_select on public.brain_source_documents
  for select using (app.has_permission(tenant_id, 'brain.read'));
create policy brain_source_documents_insert on public.brain_source_documents
  for insert with check (app.has_permission(tenant_id, 'brain.write'));
create policy brain_source_documents_update on public.brain_source_documents
  for update using (app.has_permission(tenant_id, 'brain.write'))
  with check (app.has_permission(tenant_id, 'brain.write'));

-- ── AI usage: ingestion calls are recorded in the same table the Agent's
--    calls are, so the existing per-tenant AI Cost Guard covers them too ──
alter table public.agent_interactions
  add column ingestion_job_id uuid references public.brain_ingestion_jobs(id) on delete set null,
  add column source_document_id uuid references public.brain_source_documents(id) on delete set null,
  add column purpose text;
create index agent_interactions_job_idx on public.agent_interactions (ingestion_job_id) where ingestion_job_id is not null;

create or replace function public.record_ingestion_ai_call(
  p_tenant_id uuid,
  p_job_id uuid,
  p_source_document_id uuid,
  p_purpose text,
  p_provider text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_estimated_cost_usd numeric,
  p_latency_ms integer,
  p_success boolean,
  p_error_message text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.brain_ingestion_jobs where id = p_job_id and tenant_id = p_tenant_id) then
    raise exception 'VALIDATION_ERROR: job does not belong to this tenant';
  end if;

  insert into public.agent_interactions (
    tenant_id, request_type, handled_by, provider, model, input_tokens, output_tokens,
    estimated_cost_usd, latency_ms, success, error_message, ingestion_job_id, source_document_id, purpose
  ) values (
    p_tenant_id, 'brain_ingestion', 'ai', p_provider, p_model, greatest(p_input_tokens, 0), greatest(p_output_tokens, 0),
    greatest(p_estimated_cost_usd, 0), p_latency_ms, p_success, left(p_error_message, 500), p_job_id, p_source_document_id,
    left(p_purpose, 120)
  );

  update public.brain_ingestion_jobs
    set ai_calls = ai_calls + 1,
        ai_input_tokens = ai_input_tokens + greatest(p_input_tokens, 0),
        ai_output_tokens = ai_output_tokens + greatest(p_output_tokens, 0),
        ai_cost_usd = ai_cost_usd + greatest(p_estimated_cost_usd, 0)
    where id = p_job_id;
end;
$$;
revoke all on function public.record_ingestion_ai_call(uuid, uuid, uuid, text, text, text, integer, integer, numeric, integer, boolean, text) from public;
revoke all on function public.record_ingestion_ai_call(uuid, uuid, uuid, text, text, text, integer, integer, numeric, integer, boolean, text) from anon;
grant execute on function public.record_ingestion_ai_call(uuid, uuid, uuid, text, text, text, integer, integer, numeric, integer, boolean, text) to authenticated;

-- ── ingest_brain_fact: one discovered fact candidate, with provenance,
--    unchanged-detection and cross-source conflict detection ─────────────
create or replace function public.ingest_brain_fact(
  p_tenant_id uuid,
  p_fact_key text,
  p_entry_type text,
  p_content jsonb,
  p_source text,
  p_source_id uuid,
  p_confidence_score integer,
  p_method text,
  p_model text,
  p_job_id uuid,
  p_expires_at timestamptz,
  p_critical boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_key text;
  v_norm jsonb;
  v_live public.business_brain_entries%rowtype;
  v_next_version int;
  v_id uuid;
  v_confidence text;
  v_candidates jsonb;
  v_distinct int;
  v_conflict_id uuid;
begin
  if not app.has_permission(p_tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  if p_source not in ('website', 'instagram', 'facebook', 'online_menu', 'pdf', 'document', 'image', 'google_business', 'manual', 'api') then
    raise exception 'VALIDATION_ERROR: invalid source';
  end if;
  if p_method not in ('owner', 'structured_api', 'structured_data', 'deterministic', 'ai', 'inferred') then
    raise exception 'VALIDATION_ERROR: invalid extraction method';
  end if;
  if p_fact_key !~ '^[a-z0-9][a-z0-9_.:-]{0,118}$' then
    raise exception 'VALIDATION_ERROR: invalid fact key';
  end if;
  if p_confidence_score < 0 or p_confidence_score > 100 then
    raise exception 'VALIDATION_ERROR: confidence must be 0-100';
  end if;
  if p_job_id is not null and not exists (
    select 1 from public.brain_ingestion_jobs where id = p_job_id and tenant_id = p_tenant_id
  ) then
    raise exception 'VALIDATION_ERROR: job does not belong to this tenant';
  end if;
  if p_source_id is not null and not exists (
    select 1 from public.business_sources where id = p_source_id and tenant_id = p_tenant_id
  ) then
    raise exception 'VALIDATION_ERROR: source does not belong to this tenant';
  end if;

  v_entry_key := p_fact_key || '@' || p_source;
  v_norm := coalesce(p_content -> 'normalized', p_content);
  v_confidence := case when p_confidence_score >= 85 then 'high' when p_confidence_score >= 60 then 'medium' else 'low' end;

  -- The same source saying the same thing again: refresh "last seen", no new version.
  select * into v_live
  from public.business_brain_entries
  where tenant_id = p_tenant_id and entry_key = v_entry_key and status in ('approved', 'pending_review')
  order by version desc
  limit 1;

  if v_live.id is not null and coalesce(v_live.content -> 'normalized', v_live.content) = v_norm then
    update public.business_brain_entries
      set last_seen_at = now(),
          ingestion_job_id = coalesce(p_job_id, ingestion_job_id),
          expires_at = case when status = 'approved' then expires_at else p_expires_at end
      where id = v_live.id;
    return 'unchanged';
  end if;

  update public.business_brain_entries
    set status = 'superseded'
    where tenant_id = p_tenant_id and entry_key = v_entry_key and status = 'pending_review';

  select coalesce(max(version), 0) + 1 into v_next_version
  from public.business_brain_entries
  where tenant_id = p_tenant_id and entry_key = v_entry_key;

  insert into public.business_brain_entries (
    tenant_id, entry_type, entry_key, fact_key, content, version, status, source_type, source_id, source_url,
    confidence, confidence_score, extraction_method, extraction_model, processing_version,
    first_seen_at, last_seen_at, expires_at, ingestion_job_id, created_by
  ) values (
    p_tenant_id, p_entry_type, v_entry_key, p_fact_key, p_content, v_next_version, 'pending_review', p_source, p_source_id,
    p_content ->> 'source_url', v_confidence, p_confidence_score, p_method, p_model, 'discovery-v1',
    coalesce(v_live.first_seen_at, now()), now(), p_expires_at, p_job_id, auth.uid()
  )
  returning id into v_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'brain_fact.ingested', 'business_brain_entry', v_id,
    jsonb_build_object('fact_key', p_fact_key, 'source', p_source, 'method', p_method, 'confidence', p_confidence_score));

  if not p_critical then
    return 'created';
  end if;

  -- Critical facts are never chosen silently: when live candidates for the
  -- same fact disagree across sources, (re)record every value seen.
  select
    jsonb_agg(jsonb_build_object(
      'entry_id', e.id, 'source_type', e.source_type, 'source_id', e.source_id,
      'value', e.content, 'confidence', e.confidence, 'confidence_score', e.confidence_score,
      'status', e.status, 'detected_at', coalesce(e.last_seen_at, e.created_at)
    ) order by e.confidence_score desc nulls last),
    count(distinct coalesce(e.content -> 'normalized', e.content))
  into v_candidates, v_distinct
  from public.business_brain_entries e
  where e.tenant_id = p_tenant_id and e.fact_key = p_fact_key and e.status in ('approved', 'pending_review');

  if v_distinct > 1 then
    select id into v_conflict_id
    from public.business_brain_conflicts
    where tenant_id = p_tenant_id and entry_key = p_fact_key and status = 'open'
    limit 1;

    if v_conflict_id is null then
      insert into public.business_brain_conflicts (tenant_id, entry_key, entry_type, conflicting_values)
      values (p_tenant_id, p_fact_key, p_entry_type, v_candidates);
    else
      update public.business_brain_conflicts set conflicting_values = v_candidates where id = v_conflict_id;
    end if;
    return 'conflict';
  end if;

  return 'created';
end;
$$;
revoke all on function public.ingest_brain_fact(uuid, text, text, jsonb, text, uuid, integer, text, text, uuid, timestamptz, boolean) from public;
revoke all on function public.ingest_brain_fact(uuid, text, text, jsonb, text, uuid, integer, text, text, uuid, timestamptz, boolean) from anon;
grant execute on function public.ingest_brain_fact(uuid, text, text, jsonb, text, uuid, integer, text, text, uuid, timestamptz, boolean) to authenticated;

-- ── approve_brain_entry: unchanged for classic entries; for a discovery
--    candidate the owner's choice becomes the one approved value for that
--    fact, resolves an open conflict on it, and stops expiring (it is now
--    owner-confirmed data) ────────────────────────────────────────────────
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

  update public.business_brain_entries
    set status = 'superseded'
    where tenant_id = v_row.tenant_id and entry_key = v_row.entry_key and status = 'approved';

  if v_row.fact_key is not null then
    -- One approved value per fact: the owner's choice replaces any other
    -- source's approved value, and other sources' pending candidates for
    -- the same fact are closed.
    update public.business_brain_entries
      set status = 'superseded'
      where tenant_id = v_row.tenant_id and fact_key = v_row.fact_key and id <> p_entry_id
        and status in ('approved', 'pending_review');

    update public.business_brain_conflicts
      set status = 'resolved', resolved_value = v_row.content, resolved_by = auth.uid(), resolved_at = now()
      where tenant_id = v_row.tenant_id and entry_key = v_row.fact_key and status = 'open';
  end if;

  update public.business_brain_entries
    set status = 'approved', approved_by = auth.uid(), approved_at = now(),
        last_verified_at = now(), expires_at = null
    where id = p_entry_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_row.tenant_id, auth.uid(), 'brain_entry.approved', 'business_brain_entry', p_entry_id);
end;
$$;
revoke all on function public.approve_brain_entry(uuid) from public;
revoke all on function public.approve_brain_entry(uuid) from anon;
grant execute on function public.approve_brain_entry(uuid) to authenticated;

-- ── Retention: unconfirmed facts past their expiry are emptied and
--    archived (used for Google Places content, which may only be cached
--    temporarily). Owner-confirmed facts never expire. ──────────────────
create or replace function public.purge_expired_brain_facts(p_tenant_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not app.has_permission(p_tenant_id, 'brain.write') then
    raise exception 'PERMISSION_ERROR: brain.write required' using errcode = '42501';
  end if;
  update public.business_brain_entries
    set status = 'archived', content = '{}'::jsonb, is_active = false
    where tenant_id = p_tenant_id and status = 'pending_review'
      and expires_at is not null and expires_at < now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.purge_expired_brain_facts(uuid) from public;
revoke all on function public.purge_expired_brain_facts(uuid) from anon;
grant execute on function public.purge_expired_brain_facts(uuid) to authenticated;

-- ── Interaction metrics: Business Discovery's AI calls are real tenant AI
--    spend (so they count toward cost and the AI Cost Guard), but they are
--    not customer interactions — keep them out of interaction counts and
--    the deterministic-first percentage. `create or replace` keeps each
--    function's signature and existing grants. ─────────────────────────────
create or replace function public.agent_interaction_stats(p_tenant_id uuid, p_since timestamptz default now() - interval '30 days')
returns table (
  total_interactions bigint,
  deterministic_count bigint,
  ai_count bigint,
  deterministic_pct numeric,
  total_cost_usd numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where request_type <> 'brain_ingestion'),
    count(*) filter (where handled_by = 'deterministic' and request_type <> 'brain_ingestion'),
    count(*) filter (where handled_by = 'ai' and request_type <> 'brain_ingestion'),
    round(
      100.0 * count(*) filter (where handled_by = 'deterministic' and request_type <> 'brain_ingestion')
        / greatest(count(*) filter (where request_type <> 'brain_ingestion'), 1),
      1
    ),
    coalesce(sum(estimated_cost_usd), 0)
  from public.agent_interactions
  where tenant_id = p_tenant_id and created_at >= p_since;
$$;

create or replace function public.agent_interaction_totals_by_tenant(p_since timestamptz)
returns table (tenant_id uuid, interactions bigint, deterministic bigint, cost_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ai.tenant_id,
    count(*) filter (where ai.request_type <> 'brain_ingestion'),
    count(*) filter (where ai.handled_by = 'deterministic' and ai.request_type <> 'brain_ingestion'),
    coalesce(sum(ai.estimated_cost_usd), 0)
  from public.agent_interactions ai
  where ai.created_at >= p_since
  group by ai.tenant_id;
$$;
