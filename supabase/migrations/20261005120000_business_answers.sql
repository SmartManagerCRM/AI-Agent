-- Ask SmartManager (console): answers about the business from its own data,
-- with no AI involved. One summary of a period's orders, computed in
-- Postgres under the caller's own RLS (SECURITY INVOKER), with the same
-- definitions as Analytics: sales = paid/confirmed/in-progress/completed
-- orders, in today's currency (orders placed before a currency switch are
-- converted with public.order_fx_factor).
create or replace function public.tenant_period_summary(p_tenant_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fx as (
    select c.currency, public.order_fx_factor(p_tenant_id, c.currency::text) as f
    from (select distinct currency from public.orders where tenant_id = p_tenant_id) c
  ),
  o as (
    select ord.id, ord.status, ord.created_at,
           round(ord.total_minor * coalesce(fx.f, 1))::bigint as total_minor,
           coalesce(fx.f, 1) as f,
           nullif(coalesce(ord.customer_email::text, ord.customer_phone, ord.customer_name), '') as customer_key
    from public.orders ord left join fx on fx.currency = ord.currency
    where ord.tenant_id = p_tenant_id and ord.status <> 'draft'
  ),
  cur as (select * from o where o.created_at >= p_from and o.created_at < p_to),
  settled as (select * from cur where cur.status in ('paid', 'confirmed', 'preparing', 'ready', 'completed')),
  firsts as (select customer_key, min(created_at) as first_at from o where customer_key is not null group by customer_key)
  select jsonb_build_object(
    'orders', (select count(*) from cur),
    'settled_orders', (select count(*) from settled),
    'sales_minor', coalesce((select sum(total_minor) from settled), 0),
    'by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from cur group by status) s), '{}'::jsonb),
    'customers', (select count(distinct customer_key) from cur),
    'new_customers', (select count(*) from firsts where first_at >= p_from and first_at < p_to),
    'top_products', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'quantity', t.qty, 'revenue_minor', t.revenue) order by t.qty desc, t.revenue desc)
      from (
        select oi.product_name as name, sum(oi.quantity) as qty, round(sum(oi.total_minor * s.f))::bigint as revenue
        from public.order_items oi join settled s on s.id = oi.order_id
        group by oi.product_name
        order by sum(oi.quantity) desc, sum(oi.total_minor * s.f) desc
        limit 5
      ) t
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.tenant_period_summary(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.tenant_period_summary(uuid, timestamptz, timestamptz) to authenticated;
