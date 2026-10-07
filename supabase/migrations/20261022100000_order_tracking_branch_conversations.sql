-- Order tracking, branch conversations, booking at any branch.
--
--   • An order's journey, shown to the customer on its tracking page:
--     confirmed → preparing → prepared → ready → collected (pickup) /
--     served (dine-in) / out for delivery → delivered (delivery) → completed,
--     with "paid" from the payment itself. New statuses: prepared, collected,
--     served, out_for_delivery, delivered (counted like the other active ones).
--   • order_tracking(): what the tracking page shows — only for the order's own
--     id (an unguessable link given to the customer who placed it).
--   • Conversations belong to a branch: the one the customer orders or books
--     at (or their table's). Branch staff see their branches' conversations;
--     a conversation with no branch counts as the main branch's. Customers
--     stay shared by every branch.
--   • Bookings: the customer may book at any active branch (its hours decide
--     the times), not only those open right now.

-- ── 1. Order statuses ─────────────────────────────────────────────────────
alter table public.orders drop constraint orders_status_check;
alter table public.orders add constraint orders_status_check check (status in (
  'draft', 'pending_payment', 'paid', 'confirmed', 'preparing', 'prepared', 'ready',
  'collected', 'served', 'out_for_delivery', 'delivered', 'completed', 'cancelled', 'refunded'));


-- ── 2. The customer's tracking page ───────────────────────────────────────
create or replace function public.order_tracking(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'order_id', o.id,
    'tenant_id', o.tenant_id,
    'order_number', o.order_number,
    'status', o.status,
    'fulfillment_type', o.fulfillment_type,
    'placed_at', coalesce(o.placed_at, o.created_at),
    'currency', o.currency,
    'currency_exponent', (select c.exponent from public.currencies c where c.code = o.currency),
    'total_minor', o.total_minor,
    'branch_name', (select b.name from public.branches b where b.id = o.branch_id),
    'payment_status', (select p.status from public.payments p where p.order_id = o.id order by p.created_at desc limit 1),
    'paid_at', (select p.updated_at from public.payments p where p.order_id = o.id and p.status = 'succeeded' order by p.updated_at desc limit 1),
    'items', coalesce((select jsonb_agg(jsonb_build_object('name', i.product_name, 'quantity', i.quantity) order by i.id)
                        from public.order_items i where i.order_id = o.id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('status', h.to_status, 'at', h.at) order by h.at, h.id)
                          from public.order_status_history h where h.order_id = o.id), '[]'::jsonb)
  )
  from public.orders o
  where o.id = p_order_id and o.status not in ('draft');
$$;
revoke all on function public.order_tracking(uuid) from public, anon, authenticated;
grant execute on function public.order_tracking(uuid) to service_role;

-- ── 3. Conversations belong to a branch ───────────────────────────────────
alter table public.conversations add column branch_id uuid references public.branches(id) on delete set null;
create index conversations_branch_idx on public.conversations (tenant_id, branch_id);

-- The branch the customer orders (cart) or books at becomes the conversation's.
create or replace function app.conversation_branch_from_cart()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.branch_id is not null and new.conversation_id is not null then
    update public.conversations set branch_id = new.branch_id
     where id = new.conversation_id and tenant_id = new.tenant_id and branch_id is distinct from new.branch_id;
  end if;
  return null;
end;
$$;
revoke all on function app.conversation_branch_from_cart() from public, anon, authenticated;
create trigger conversation_branch_from_cart after insert or update of branch_id on public.carts
  for each row execute function app.conversation_branch_from_cart();
create trigger conversation_branch_from_booking after insert or update of branch_id on public.bookings
  for each row execute function app.conversation_branch_from_cart();

alter policy conversations_select on public.conversations
  using ((app.has_permission(tenant_id, 'agent.read') and app.can_access_branch(tenant_id, branch_id)) or app.is_super_admin());

create or replace function app.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select app.can_access_branch(c.tenant_id, c.branch_id) from public.conversations c where c.id = p_conversation_id), false);
$$;
revoke all on function app.can_access_conversation(uuid) from public, anon;
grant execute on function app.can_access_conversation(uuid) to authenticated, service_role;

alter policy conversation_messages_select on public.conversation_messages
  using ((app.has_permission(tenant_id, 'agent.read') and app.can_access_conversation(conversation_id)) or app.is_super_admin());

-- ── 4. Bookings at any active branch ──────────────────────────────────────
-- Pickup and delivery: the branches open right now (delivery: delivering).
-- Bookings: every active branch — its own hours decide the times offered.
create or replace function public.open_branches(p_tenant_id uuid, p_purpose text)
returns table (id uuid, name jsonb, address jsonb, phone text, is_default boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.name, b.address, b.phone, b.is_default
    from public.branches b
   where b.tenant_id = p_tenant_id and b.is_active
     and p_purpose in ('pickup', 'delivery', 'booking')
     and (p_purpose <> 'delivery' or b.offers_delivery)
     and (p_purpose = 'booking' or app.branch_open_at(b.id, now()))
   order by b.is_default desc, b.created_at;
$$;

-- ── 5. Order statuses: transitions and the active/settled sets ────────────
create or replace function public.update_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row public.orders%rowtype;
  v_allowed text[];
begin
  select * into v_row from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not app.has_permission(v_row.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if not app.can_access_branch(v_row.tenant_id, v_row.branch_id) then
    raise exception 'PERMISSION_ERROR: this order belongs to another branch' using errcode = '42501';
  end if;

  -- The order's journey: confirmed → preparing → prepared → ready → collected (pickup) /
  -- served (dine-in) / out for delivery → delivered (delivery) → completed. "Paid" is the
  -- payment's own state (collected in cash, or paid online), shown alongside.
  v_allowed := case v_row.status
    when 'draft' then array['pending_payment', 'cancelled']
    when 'pending_payment' then array['paid', 'cancelled']
    when 'paid' then array['confirmed', 'refunded']
    when 'confirmed' then array['preparing', 'cancelled']
    when 'preparing' then array['prepared', 'ready', 'cancelled']
    when 'prepared' then array['ready', 'cancelled']
    when 'ready' then array[
      case v_row.fulfillment_type when 'pickup' then 'collected' when 'dine_in' then 'served' else 'out_for_delivery' end,
      'completed', 'cancelled']
    when 'out_for_delivery' then array['delivered', 'cancelled']
    when 'collected' then array['completed']
    when 'served' then array['completed']
    when 'delivered' then array['completed']
    else array[]::text[]
  end;
  if not (p_new_status = any(v_allowed)) then
    raise exception 'VALIDATION_ERROR: % cannot move to % directly', v_row.status, p_new_status;
  end if;

  update public.orders
    set status = p_new_status, completed_at = case when p_new_status = 'completed' then now() else completed_at end
    where id = p_order_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
  values (v_row.tenant_id, p_order_id, v_row.status, p_new_status, 'staff', p_note);

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (v_row.tenant_id, auth.uid(), 'order.status_changed', 'order', p_order_id,
    jsonb_build_object('from', v_row.status, 'to', p_new_status));
end;
$function$;

create or replace function public.tenant_analytics_stats(p_tenant_id uuid, p_locale text, p_range_days integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with b as (
    select
      now() - make_interval(days => p_range_days) as cur_start,
      now() - make_interval(days => 2 * p_range_days) as prior_start,
      (now() at time zone 'UTC')::date - (p_range_days - 1) as series_start
  ),
  fx as (
    -- Orders placed in an earlier currency, expressed in today's (see public.order_fx_factor).
    select c.currency, public.order_fx_factor(p_tenant_id, c.currency::text) as f
    from (select distinct currency from public.orders where tenant_id = p_tenant_id) c
  ),
  o as (
    select ord.id, round(ord.total_minor * coalesce(fx.f, 1))::bigint as total_minor, ord.currency, ord.status, ord.created_at,
      (ord.created_at >= b.cur_start) as is_current
    from public.orders ord cross join b left join fx on fx.currency = ord.currency
    where ord.tenant_id = p_tenant_id and ord.created_at >= b.prior_start
  ),
  cur as (select * from o where is_current),
  settled as (
    select * from cur where status in ('paid', 'confirmed', 'preparing', 'prepared', 'ready', 'collected', 'served', 'out_for_delivery', 'delivered', 'completed')
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
          sum(round(oi.total_minor * coalesce(fx.f, 1)))::bigint as revenue_minor
        from public.order_items oi
        join settled s on s.id = oi.order_id
        left join fx on fx.currency = s.currency
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

create or replace function public.tenant_period_summary(p_tenant_id uuid, p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
  settled as (select * from cur where cur.status in ('paid', 'confirmed', 'preparing', 'prepared', 'ready', 'collected', 'served', 'out_for_delivery', 'delivered', 'completed')),
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
$function$;
