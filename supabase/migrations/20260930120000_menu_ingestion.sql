-- Direct menu / catalog URL ingestion (image-based menus): new source and
-- extraction vocabularies, per-source analysis metrics, and price-aware
-- conflict detection. Additive; same-signature function replacement.

-- ── Sources: online ordering is its own source (its prices can disagree
--    with the menu page's or a menu image's, and that must surface) ─────
alter table public.business_sources drop constraint business_sources_source_type_check;
alter table public.business_sources add constraint business_sources_source_type_check check (
  source_type in (
    'website', 'instagram', 'facebook', 'online_menu', 'online_ordering', 'pdf', 'document',
    'image', 'google_business', 'manual', 'api'
  )
);
alter table public.business_brain_entries drop constraint business_brain_entries_source_type_check;
alter table public.business_brain_entries add constraint business_brain_entries_source_type_check check (
  source_type in (
    'website', 'instagram', 'facebook', 'online_menu', 'online_ordering', 'pdf', 'document',
    'image', 'google_business', 'manual', 'api'
  )
);

-- Menu/catalog analysis figures shown to the owner (images found/processed,
-- products, categories, prices, descriptions, related pages, ordering).
alter table public.business_sources add column metrics jsonb;

-- ── Extraction methods: OCR and vision (menu images) ─────────────────────
alter table public.business_brain_entries drop constraint business_brain_entries_extraction_method_check;
alter table public.business_brain_entries add constraint business_brain_entries_extraction_method_check check (
  extraction_method in ('owner', 'structured_api', 'structured_data', 'deterministic', 'ocr', 'vision', 'ai', 'inferred')
);

-- ── ingest_brain_fact: new vocabularies + price-aware conflicts ──────────
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
  if p_source not in ('website', 'instagram', 'facebook', 'online_menu', 'online_ordering', 'pdf', 'document', 'image', 'google_business', 'manual', 'api') then
    raise exception 'VALIDATION_ERROR: invalid source';
  end if;
  if p_method not in ('owner', 'structured_api', 'structured_data', 'deterministic', 'ocr', 'vision', 'ai', 'inferred') then
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
    -- The value that matters for disagreement: `conflict_value` when a fact
    -- defines one (a product's price), else the whole normalized value. A
    -- candidate with no such value (a product listed without a price)
    -- never counts as disagreeing.
    count(distinct case
      when e.content ? 'conflict_value' then nullif(e.content -> 'conflict_value', 'null'::jsonb)
      else coalesce(e.content -> 'normalized', e.content)
    end)
  into v_candidates, v_distinct
  from public.business_brain_entries e
  where e.tenant_id = p_tenant_id and e.fact_key = p_fact_key and e.status in ('approved', 'pending_review');

  if v_distinct <= 1 then
    -- Sources agree again (e.g. a price was corrected): close a stale conflict.
    update public.business_brain_conflicts
      set status = 'resolved', resolved_at = now()
      where tenant_id = p_tenant_id and entry_key = p_fact_key and status = 'open';
  end if;

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
