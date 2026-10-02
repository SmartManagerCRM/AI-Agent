-- Premium voice generations (request_type 'voice_tts') are recorded in the
-- Agent interaction ledger so they count toward the same AI cost allowance —
-- but they are not customer interactions or AI responses. Until now they
-- were counted as both: Super Admin's "AI responses", the Agent stats
-- (interactions, AI-handled count, deterministic share) on Business 360,
-- the subscriber's Agent page and the AI Agents list. Here voice is taken
-- out of those counts and reported on its own (cost, clips, characters).
-- The AI cost cap is unchanged: ai_usage_periods still includes voice.

create or replace function public.platform_usage_overview(p_tenant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(row_data order by row_data ->> 'business_name'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'tenant_id', t.id,
      'slug', t.slug,
      'business_name', coalesce(t.business_name ->> 'en', t.business_name ->> (select k from jsonb_object_keys(t.business_name) k limit 1), t.slug),
      'tenant_status', t.status,
      'ai_cost_limit_default', (select l.limit_usd from public.ai_cost_limits l where l.plan_key = s.plan_key),
      'ai_cost_limit_override', (select l.limit_usd from public.ai_cost_limits l where l.tenant_id = t.id),
      'agent_ai_cost', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type not in ('brain_ingestion', 'voice_tts')
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'agent_ai_responses', (select count(*) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type not in ('brain_ingestion', 'voice_tts') and i.handled_by = 'ai' and i.success
            and i.created_at >= (snap ->> 'period_start')::timestamptz),
      -- Premium voice: audio generated (cache misses only; replays from the cache cost nothing and aren't recorded).
      'agent_voice_cost', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'voice_tts'
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'agent_voice_clips', (select count(*) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'voice_tts' and i.success
            and i.created_at >= (snap ->> 'period_start')::timestamptz),
      'agent_voice_characters', coalesce((select sum(i.input_tokens) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'voice_tts' and i.success
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'brain_ai_cost', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'brain_ingestion'
            and i.created_at >= (snap ->> 'period_start')::timestamptz), 0),
      'brain_ai_cost_total', coalesce((select sum(i.estimated_cost_usd) from public.agent_interactions i
          where i.tenant_id = t.id and i.request_type = 'brain_ingestion'), 0)
    ) || snap as row_data
    from public.tenants t
    join public.subscriptions s on s.tenant_id = t.id
    cross join lateral (select app.usage_snapshot(t.id, false) as snap) x
    where p_tenant_id is null or t.id = p_tenant_id
  ) rows;
  return v_rows;
end;
$$;
revoke all on function public.platform_usage_overview(uuid) from public, anon;
grant execute on function public.platform_usage_overview(uuid) to authenticated;

create or replace function public.agent_interaction_stats(p_tenant_id uuid, p_since timestamptz default now() - interval '30 days')
returns table(total_interactions bigint, deterministic_count bigint, ai_count bigint, deterministic_pct numeric, total_cost_usd numeric)
language sql
stable
set search_path = ''
as $function$
  select
    count(*) filter (where request_type not in ('brain_ingestion', 'voice_tts')),
    count(*) filter (where handled_by = 'deterministic' and request_type not in ('brain_ingestion', 'voice_tts')),
    count(*) filter (where handled_by = 'ai' and request_type not in ('brain_ingestion', 'voice_tts')),
    round(
      100.0 * count(*) filter (where handled_by = 'deterministic' and request_type not in ('brain_ingestion', 'voice_tts'))
        / greatest(count(*) filter (where request_type not in ('brain_ingestion', 'voice_tts')), 1),
      1
    ),
    public.super_admin_ai_cost(p_tenant_id, p_since)
  from public.agent_interactions
  where tenant_id = p_tenant_id and created_at >= p_since;
$function$;

create or replace function public.agent_interaction_totals_by_tenant(p_since timestamptz)
returns table(tenant_id uuid, interactions bigint, deterministic bigint, cost_usd numeric)
language sql
stable
set search_path = ''
as $function$
  select
    ai.tenant_id,
    count(*) filter (where ai.request_type not in ('brain_ingestion', 'voice_tts')),
    count(*) filter (where ai.handled_by = 'deterministic' and ai.request_type not in ('brain_ingestion', 'voice_tts')),
    public.super_admin_ai_cost(ai.tenant_id, p_since)
  from public.agent_interactions ai
  where ai.created_at >= p_since
  group by ai.tenant_id;
$function$;
