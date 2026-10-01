-- Subscribers never see AI cost — not in the UI, and not through the API.
--
-- Until now a subscriber could read their own AI spend directly: the
-- `estimated_cost_usd` column of their Agent interactions, the cost and
-- budget columns of their Business Brain jobs, the model token prices, and
-- the cost totals returned by `agent_interaction_stats` /
-- `tenant_analytics_stats`. Those figures are now Super Admin only:
--
-- * Column-level grants hide the cost/price columns from signed-in users
--   (RLS can't hide a column). Server code that needs them (the Agent
--   gateway, Business Brain discovery, Super Admin pages) reads them with
--   the service role.
-- * The stats functions keep working for subscribers; their cost figures
--   come from `public.super_admin_ai_cost`, which returns null to anyone but
--   Super Admin. (It lives in `public` because the stats functions run with
--   the caller's rights, and signed-in users can't use the `app` schema.)

create or replace function public.super_admin_ai_cost(p_tenant_id uuid, p_from timestamptz, p_to timestamptz default null)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select case when app.is_super_admin() then coalesce((
    select sum(i.estimated_cost_usd) from public.agent_interactions i
    where i.tenant_id = p_tenant_id and i.created_at >= p_from and (p_to is null or i.created_at < p_to)
  ), 0) end;
$function$;
revoke all on function public.super_admin_ai_cost(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.super_admin_ai_cost(uuid, timestamptz, timestamptz) to authenticated, service_role;

create or replace function public.agent_interaction_stats(p_tenant_id uuid, p_since timestamptz default now() - interval '30 days')
returns table(total_interactions bigint, deterministic_count bigint, ai_count bigint, deterministic_pct numeric, total_cost_usd numeric)
language sql
stable
set search_path = ''
as $function$
  select
    count(*) filter (where request_type <> 'brain_ingestion'),
    count(*) filter (where handled_by = 'deterministic' and request_type <> 'brain_ingestion'),
    count(*) filter (where handled_by = 'ai' and request_type <> 'brain_ingestion'),
    round(
      100.0 * count(*) filter (where handled_by = 'deterministic' and request_type <> 'brain_ingestion')
        / greatest(count(*) filter (where request_type <> 'brain_ingestion'), 1),
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
    count(*) filter (where ai.request_type <> 'brain_ingestion'),
    count(*) filter (where ai.handled_by = 'deterministic' and ai.request_type <> 'brain_ingestion'),
    public.super_admin_ai_cost(ai.tenant_id, p_since)
  from public.agent_interactions ai
  where ai.created_at >= p_since
  group by ai.tenant_id;
$function$;

create or replace function public.tenant_analytics_stats(p_tenant_id uuid, p_locale text, p_range_days integer)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  with b as (
    select
      now() - make_interval(days => p_range_days) as cur_start,
      now() - make_interval(days => 2 * p_range_days) as prior_start,
      (now() at time zone 'UTC')::date - (p_range_days - 1) as series_start
  ),
  o as (
    select ord.id, ord.total_minor, ord.status, ord.created_at, (ord.created_at >= b.cur_start) as is_current
    from public.orders ord cross join b
    where ord.tenant_id = p_tenant_id and ord.created_at >= b.prior_start
  ),
  cur as (select * from o where is_current),
  settled as (
    select * from cur where status in ('paid', 'confirmed', 'preparing', 'ready', 'completed')
  ),
  -- AI cost: Super Admin only (null for anyone else — subscribers never see it).
  ai as (
    select
      public.super_admin_ai_cost(p_tenant_id, b.cur_start) as current_cost_usd,
      public.super_admin_ai_cost(p_tenant_id, b.prior_start, b.cur_start) as prior_cost_usd
    from b
  )
  select jsonb_build_object(
    'current_sales_minor', coalesce((select sum(total_minor) from cur), 0),
    'current_orders', (select count(*) from cur),
    'prior_sales_minor', coalesce((select sum(total_minor) from o where not is_current), 0),
    'prior_orders', (select count(*) from o where not is_current),
    'current_ai_cost_usd', (select current_cost_usd from ai),
    'prior_ai_cost_usd', (select prior_cost_usd from ai),
    'sales_by_day', coalesce((
      select jsonb_object_agg(d.day, d.total_minor)
      from (
        select to_char((cur.created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, sum(cur.total_minor) as total_minor
        from cur cross join b
        where (cur.created_at at time zone 'UTC')::date >= b.series_start
        group by 1
      ) d
    ), '{}'::jsonb),
    'status_counts', coalesce((
      select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from cur group by status) s
    ), '{}'::jsonb),
    'settled_orders', (select count(*) from settled),
    'top_products', coalesce((
      select jsonb_agg(
        jsonb_build_object('name', p.name, 'quantity', p.quantity, 'revenue_minor', p.revenue_minor)
        order by p.revenue_minor desc, p.name
      )
      from (
        select
          coalesce(oi.product_name ->> p_locale, oi.product_name ->> 'en', '—') as name,
          sum(oi.quantity) as quantity,
          sum(oi.total_minor) as revenue_minor
        from public.order_items oi
        join settled s on s.id = oi.order_id
        group by 1
        order by 3 desc, 1
        limit 10
      ) p
    ), '[]'::jsonb),
    'payment_methods', coalesce((
      select jsonb_object_agg(m.provider, m.n)
      from (
        select
          coalesce(
            (select pay.provider from public.payments pay where pay.order_id = s.id and pay.status = 'succeeded' limit 1),
            'cash'
          ) as provider,
          count(*) as n
        from settled s
        group by 1
      ) m
    ), '{}'::jsonb),
    'conversations_started', (
      select count(*) from public.conversations c cross join b
      where c.tenant_id = p_tenant_id and c.created_at >= b.cur_start
    ),
    'carts_started', (
      select count(distinct ci.cart_id) from public.cart_items ci cross join b
      where ci.tenant_id = p_tenant_id and ci.created_at >= b.cur_start
    )
  );
$function$;

-- Cost and price columns: hidden from signed-in users.
revoke select on public.agent_interactions from anon, authenticated;
grant select (id, tenant_id, request_type, handled_by, deterministic_rule, provider, model, input_tokens, output_tokens,
  latency_ms, success, fallback_used, error_message, created_at, ingestion_job_id, source_document_id, purpose)
  on public.agent_interactions to authenticated;

revoke select on public.brain_ingestion_jobs from anon, authenticated;
grant select (id, tenant_id, trigger, input, status, status_reason, place_id, detected_business_type, started_at, completed_at,
  sources_processed, pages_processed, documents_processed, facts_proposed, conflicts_detected, ai_calls, ai_input_tokens,
  ai_output_tokens, google_calls, warnings, errors, readiness, created_by, created_at, updated_at)
  on public.brain_ingestion_jobs to authenticated;

revoke select on public.ai_model_configs from anon, authenticated;
grant select (id, provider, model, kind, is_active, is_default, notes, created_at, updated_at)
  on public.ai_model_configs to authenticated;
