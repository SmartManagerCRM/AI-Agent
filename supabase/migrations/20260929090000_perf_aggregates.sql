-- Performance: database-side aggregation for the console's heaviest reads.
--
-- Before this, the tenant dashboard/analytics/customers pages and the
-- Super Admin layout downloaded whole tables (every order, every order
-- item, every AI interaction for a month...) and summed them in
-- JavaScript. Besides the transfer cost, PostgREST caps a response at
-- 1000 rows, so past that size those numbers were silently truncated.
--
-- Every function here is SECURITY INVOKER: it runs under the caller's own
-- RLS policies, exactly like the direct SELECTs it replaces, so it can
-- never see a row the caller couldn't already select — a caller passing
-- another tenant's id gets the same empty result RLS gave before. Each is
-- STABLE, pins an empty search_path, and is executable only by signed-in
-- users (never `anon`). No table, column, policy or row is changed.

-- ── Tenant dashboard (src/server/tenant/dashboard-stats.ts) ──────────────
-- Mirrors the previous JS exactly: all-time totals over every order;
-- customers = distinct non-empty `email ?? phone ?? name` (email cast to
-- text — the JS Set it replaces was case-sensitive, citext is not);
-- current window = [now - N days, now), prior = [now - 2N, now - N);
-- sales by UTC calendar day for the last N days; per-status counts (the
-- status → group mapping stays in TypeScript); top 5 products by revenue
-- over every order item, named by locale, then 'en', then '—'.
create or replace function public.tenant_dashboard_stats(p_tenant_id uuid, p_locale text, p_window_days integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with o as (
    select
      total_minor,
      status,
      created_at,
      nullif(coalesce(customer_email::text, customer_phone, customer_name), '') as customer_key
    from public.orders
    where tenant_id = p_tenant_id
  ),
  b as (
    select
      now() - make_interval(days => p_window_days) as cur_start,
      now() - make_interval(days => 2 * p_window_days) as prior_start,
      (now() at time zone 'UTC')::date - (p_window_days - 1) as series_start
  ),
  totals as (
    select
      coalesce(sum(o.total_minor), 0) as total_sales_minor,
      count(*) as orders_count,
      count(distinct o.customer_key) as customers_count,
      coalesce(sum(o.total_minor) filter (where o.created_at >= b.cur_start), 0) as current_sales_minor,
      count(*) filter (where o.created_at >= b.cur_start) as current_orders,
      count(distinct o.customer_key) filter (where o.created_at >= b.cur_start) as current_customers,
      coalesce(sum(o.total_minor) filter (where o.created_at >= b.prior_start and o.created_at < b.cur_start), 0)
        as prior_sales_minor,
      count(*) filter (where o.created_at >= b.prior_start and o.created_at < b.cur_start) as prior_orders,
      count(distinct o.customer_key) filter (where o.created_at >= b.prior_start and o.created_at < b.cur_start)
        as prior_customers
    from o cross join b
  )
  select jsonb_build_object(
    'total_sales_minor', t.total_sales_minor,
    'orders_count', t.orders_count,
    'customers_count', t.customers_count,
    'current_sales_minor', t.current_sales_minor,
    'current_orders', t.current_orders,
    'current_customers', t.current_customers,
    'prior_sales_minor', t.prior_sales_minor,
    'prior_orders', t.prior_orders,
    'prior_customers', t.prior_customers,
    'sales_by_day', coalesce((
      select jsonb_object_agg(d.day, d.total_minor)
      from (
        select to_char((o.created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day, sum(o.total_minor) as total_minor
        from o cross join b
        where (o.created_at at time zone 'UTC')::date >= b.series_start
        group by 1
      ) d
    ), '{}'::jsonb),
    'status_counts', coalesce((
      select jsonb_object_agg(s.status, s.n) from (select o.status, count(*) as n from o group by o.status) s
    ), '{}'::jsonb),
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
        where oi.tenant_id = p_tenant_id
        group by 1
        order by 3 desc, 1
        limit 5
      ) p
    ), '[]'::jsonb)
  )
  from totals t;
$$;

-- ── Tenant analytics (src/server/tenant/analytics-stats.ts) ──────────────
-- Same window semantics over [now - 2N, now). "Settled" = the TypeScript
-- status groups `active` + `completed` (paid, confirmed, preparing, ready,
-- completed — keep in sync with src/lib/order-status.ts). A settled
-- order's payment method is its succeeded payment's provider, else 'cash'
-- (cash on delivery / pay on table write no payments row). Funnel counts
-- are over the current window only.
create or replace function public.tenant_analytics_stats(p_tenant_id uuid, p_locale text, p_range_days integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
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
  ai as (
    select
      coalesce(sum(ai.estimated_cost_usd) filter (where ai.created_at >= b.cur_start), 0) as current_cost_usd,
      coalesce(sum(ai.estimated_cost_usd) filter (where ai.created_at < b.cur_start), 0) as prior_cost_usd
    from public.agent_interactions ai cross join b
    where ai.tenant_id = p_tenant_id and ai.created_at >= b.prior_start
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
$$;

-- ── Customers page (src/app/console/[locale]/t/[slug]/customers) ────────
-- A customer is `email ?? phone ?? name ?? 'unknown'` (email as text, as
-- above); display name/contact come from that customer's most recent
-- order. Sorted by total spend, ties by most recent order — the same order
-- the previous stable JS sort produced. KPIs cover every customer; the
-- search (case-insensitive substring of the name) only narrows the rows.
create or replace function public.tenant_customer_summary(
  p_tenant_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with o as (
    select
      coalesce(customer_email::text, customer_phone, customer_name, 'unknown') as customer_key,
      customer_name,
      customer_email::text as customer_email,
      customer_phone,
      total_minor,
      created_at
    from public.orders
    where tenant_id = p_tenant_id
  ),
  g as (
    select
      customer_key,
      (array_agg(coalesce(customer_name, '—') order by created_at desc))[1] as name,
      (array_agg(customer_email order by created_at desc))[1] as email,
      (array_agg(customer_phone order by created_at desc))[1] as phone,
      count(*) as order_count,
      sum(total_minor) as total_spent_minor,
      max(created_at) as last_order_at
    from o
    group by customer_key
  ),
  f as (
    select * from g
    where coalesce(p_search, '') = '' or strpos(lower(g.name), lower(p_search)) > 0
  )
  select jsonb_build_object(
    'customers', (select count(*) from g),
    'repeat_customers', (select count(*) from g where order_count > 1),
    'total_spent_minor', coalesce((select sum(total_spent_minor) from g), 0),
    'filtered_count', (select count(*) from f),
    'rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'key', r.customer_key,
          'name', r.name,
          'email', r.email,
          'phone', r.phone,
          'order_count', r.order_count,
          'total_spent_minor', r.total_spent_minor,
          'last_order_at', r.last_order_at
        )
        order by r.total_spent_minor desc, r.last_order_at desc, r.customer_key
      )
      from (
        select * from f
        order by total_spent_minor desc, last_order_at desc, customer_key
        limit greatest(p_limit, 0) offset greatest(p_offset, 0)
      ) r
    ), '[]'::jsonb)
  );
$$;

-- ── Marketing page: total discount granted through coupons ───────────────
create or replace function public.tenant_coupon_discount_total(p_tenant_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(discount_minor), 0)::bigint
  from public.orders
  where tenant_id = p_tenant_id and coupon_id is not null;
$$;

-- ── Conversations page: each conversation's latest message only ─────────
-- Replaces fetching every message of the listed conversations to keep the
-- newest one per conversation; served by conversation_messages_conversation_idx.
create or replace function public.conversation_last_messages(p_conversation_ids uuid[])
returns table (conversation_id uuid, role text, content text, handled_by text)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct on (m.conversation_id) m.conversation_id, m.role, m.content, m.handled_by
  from public.conversation_messages m
  where m.conversation_id = any(p_conversation_ids)
  order by m.conversation_id, m.created_at desc;
$$;

-- ── Super Admin: per-tenant AI interaction totals since a point in time ──
-- Used by the AI Cost Guard alerts (every Super Admin page) and the
-- platform AI usage tile, which previously downloaded every interaction.
create or replace function public.agent_interaction_totals_by_tenant(p_since timestamptz)
returns table (tenant_id uuid, interactions bigint, deterministic bigint, cost_usd numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    ai.tenant_id,
    count(*),
    count(*) filter (where ai.handled_by = 'deterministic'),
    coalesce(sum(ai.estimated_cost_usd), 0)
  from public.agent_interactions ai
  where ai.created_at >= p_since
  group by ai.tenant_id;
$$;

-- ── Super Admin: conversations started per tenant in a window ────────────
create or replace function public.conversation_counts_by_tenant(p_since timestamptz, p_until timestamptz)
returns table (tenant_id uuid, conversations bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.tenant_id, count(*)
  from public.conversations c
  where c.started_at >= p_since and (p_until is null or c.started_at < p_until)
  group by c.tenant_id;
$$;

-- ── Super Admin: conversations started per UTC day ───────────────────────
create or replace function public.conversations_started_per_day(p_since timestamptz)
returns table (day text, conversations bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select to_char((c.started_at at time zone 'UTC')::date, 'YYYY-MM-DD'), count(*)
  from public.conversations c
  where c.started_at >= p_since
  group by 1;
$$;

revoke all on function public.tenant_dashboard_stats(uuid, text, integer) from public, anon;
revoke all on function public.tenant_analytics_stats(uuid, text, integer) from public, anon;
revoke all on function public.tenant_customer_summary(uuid, text, integer, integer) from public, anon;
revoke all on function public.tenant_coupon_discount_total(uuid) from public, anon;
revoke all on function public.conversation_last_messages(uuid[]) from public, anon;
revoke all on function public.agent_interaction_totals_by_tenant(timestamptz) from public, anon;
revoke all on function public.conversation_counts_by_tenant(timestamptz, timestamptz) from public, anon;
revoke all on function public.conversations_started_per_day(timestamptz) from public, anon;

grant execute on function public.tenant_dashboard_stats(uuid, text, integer) to authenticated;
grant execute on function public.tenant_analytics_stats(uuid, text, integer) to authenticated;
grant execute on function public.tenant_customer_summary(uuid, text, integer, integer) to authenticated;
grant execute on function public.tenant_coupon_discount_total(uuid) to authenticated;
grant execute on function public.conversation_last_messages(uuid[]) to authenticated;
grant execute on function public.agent_interaction_totals_by_tenant(timestamptz) to authenticated;
grant execute on function public.conversation_counts_by_tenant(timestamptz, timestamptz) to authenticated;
grant execute on function public.conversations_started_per_day(timestamptz) to authenticated;
