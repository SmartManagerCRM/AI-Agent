-- Real-time console notifications: one event per real business moment.
--
--   new_order_received     tenant    an order the business must act on: placed
--                                     as `confirmed` (cash on delivery / pay on
--                                     table) or moved `pending_payment`/`draft`
--                                     → `paid` by a verified payment.
--   new_subscriber         platform  a business signed up (create_business).
--   subscription_upgraded  platform  a paid subscription moved to a higher plan
--                                     (verified subscription payment) — never a
--                                     Super Admin edit.
--
-- Events are written only by the triggers below (SECURITY DEFINER), follow
-- the existing order and subscription state machines, and are idempotent:
-- `dedupe_key` is unique, so a duplicate webhook or a repeated status write
-- can never create a second event. A failure here is logged and swallowed —
-- a notification must never stop an order or a signup from being saved.
--
-- Who can read (and so who Supabase Realtime delivers to, since Realtime
-- applies RLS to every change it sends):
--   tenant events   → members of that business with `orders.read`
--   platform events → Super Admin only
-- Nobody can insert, update or delete through the API.

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('new_order_received', 'new_subscriber', 'subscription_upgraded')),
  audience text not null check (audience in ('tenant', 'platform')),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entity_id uuid not null,
  dedupe_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((kind = 'new_order_received') = (audience = 'tenant'))
);
create index notification_events_tenant_idx on public.notification_events (tenant_id, created_at desc);
create index notification_events_audience_idx on public.notification_events (audience, created_at desc);

alter table public.notification_events enable row level security;
alter table public.notification_events force row level security;
create policy notification_events_select on public.notification_events
  for select to authenticated
  using (
    (audience = 'tenant' and app.has_permission(tenant_id, 'orders.read'))
    or (audience = 'platform' and app.is_super_admin())
  );
revoke all on public.notification_events from anon, authenticated;
grant select on public.notification_events to authenticated;

-- Supabase Realtime streams inserts on tables in its publication (absent on
-- a plain Postgres, e.g. local tests — then this is skipped).
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notification_events'
     ) then
    alter publication supabase_realtime add table public.notification_events;
  end if;
end;
$$;

-- ── Recording ─────────────────────────────────────────────────────────────
create or replace function app.record_notification_event(
  p_kind text, p_audience text, p_tenant_id uuid, p_entity_id uuid, p_dedupe_key text, p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  begin
    insert into public.notification_events (kind, audience, tenant_id, entity_id, dedupe_key, payload)
    values (p_kind, p_audience, p_tenant_id, p_entity_id, p_dedupe_key, p_payload)
    on conflict (dedupe_key) do nothing;
    -- Events are only needed while a console is open; keep the table small.
    if random() < 0.02 then
      delete from public.notification_events where created_at < now() - interval '30 days';
    end if;
  exception when others then
    raise warning 'notification event % not recorded: %', p_dedupe_key, sqlerrm;
  end;
end;
$function$;
revoke all on function app.record_notification_event(text, text, uuid, uuid, text, jsonb) from public;

-- ── New order received ────────────────────────────────────────────────────
-- Deferred to commit: `create_order_from_cart` inserts the order before its
-- items, and the status is re-read so only the order's final state counts.
create or replace function app.notify_order_received()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_items integer;
begin
  begin
    if tg_op = 'UPDATE' and old.status not in ('draft', 'pending_payment') then
      return null;
    end if;
    select * into v_order from public.orders where id = new.id;
    if not found or v_order.status not in ('paid', 'confirmed') then
      return null;
    end if;
    select coalesce(sum(quantity), 0)::integer into v_items from public.order_items where order_id = v_order.id;
    perform app.record_notification_event(
      'new_order_received', 'tenant', v_order.tenant_id, v_order.id, 'new_order_received:' || v_order.id,
      jsonb_build_object(
        'order_id', v_order.id,
        'order_number', v_order.order_number,
        'status', v_order.status,
        'items', v_items,
        'total_minor', v_order.total_minor,
        'currency', v_order.currency,
        'currency_exponent', (select exponent from public.currencies where code = v_order.currency),
        'fulfillment_type', v_order.fulfillment_type,
        'placed_at', v_order.placed_at
      )
    );
  exception when others then
    -- Never let a notification problem undo the order, signup or payment.
    raise warning '%: notification skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;

create constraint trigger notify_order_received
  after insert or update of status on public.orders
  deferrable initially deferred
  for each row execute function app.notify_order_received();

-- ── New subscriber ────────────────────────────────────────────────────────
-- Deferred to commit so the subscription and owner created alongside the
-- business (create_business) are part of the event.
create or replace function app.notify_new_subscriber()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant public.tenants%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan_name text;
  v_owner_email text;
begin
  begin
    select * into v_tenant from public.tenants where id = new.id;
    if not found then
      return null;
    end if;
    select * into v_sub from public.subscriptions where tenant_id = v_tenant.id;
    if found then
      select coalesce(name ->> 'en', key) into v_plan_name from public.subscription_plans where key = v_sub.plan_key;
    end if;
    select p.email into v_owner_email
    from public.tenant_members tm
    join public.roles r on r.id = tm.role_id and r.key = 'business_owner' and r.tenant_id is null
    join public.profiles p on p.id = tm.user_id
    where tm.tenant_id = v_tenant.id
    order by tm.created_at
    limit 1;

    perform app.record_notification_event(
      'new_subscriber', 'platform', v_tenant.id, v_tenant.id, 'new_subscriber:' || v_tenant.id,
      jsonb_build_object(
        'tenant_id', v_tenant.id,
        'slug', v_tenant.slug,
        'business_name', coalesce(v_tenant.business_name ->> 'en', (select value from jsonb_each_text(v_tenant.business_name) limit 1), v_tenant.slug),
        'business_type_key', v_tenant.business_type_key,
        'country', v_tenant.country,
        'city', v_tenant.city,
        'plan_key', v_sub.plan_key,
        'plan_name', v_plan_name,
        'subscription_status', v_sub.status,
        'trial_ends_at', v_sub.trial_ends_at,
        'owner_email', v_owner_email,
        'registered_at', v_tenant.created_at
      )
    );
  exception when others then
    -- Never let a notification problem undo the order, signup or payment.
    raise warning '%: notification skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;

create constraint trigger notify_new_subscriber
  after insert on public.tenants
  deferrable initially deferred
  for each row execute function app.notify_new_subscriber();

-- ── Subscription upgraded ─────────────────────────────────────────────────
-- A plan is "higher" when it costs more per month (yearly plans counted per
-- month), then by its catalogue position. Only an active (paid) result
-- counts: a checkout, a pending or failed payment never changes the
-- subscription row, and a Super Admin's own edit is not a subscriber upgrade.
create or replace function app.notify_subscription_upgraded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old public.subscription_plans%rowtype;
  v_new public.subscription_plans%rowtype;
  v_tenant public.tenants%rowtype;
begin
  begin
    if new.plan_key is not distinct from old.plan_key or new.status <> 'active' or app.is_super_admin() then
      return null;
    end if;
    select * into v_old from public.subscription_plans where key = old.plan_key;
    select * into v_new from public.subscription_plans where key = new.plan_key;
    if v_old.key is null or v_new.key is null then
      return null;
    end if;
    if (v_new.price_minor::numeric / case v_new.billing_interval when 'year' then 12 else 1 end, v_new.sort_order)
       <= (v_old.price_minor::numeric / case v_old.billing_interval when 'year' then 12 else 1 end, v_old.sort_order) then
      return null;
    end if;
    select * into v_tenant from public.tenants where id = new.tenant_id;

    perform app.record_notification_event(
      'subscription_upgraded', 'platform', new.tenant_id, new.tenant_id,
      'subscription_upgraded:' || new.tenant_id || ':' || old.plan_key || '>' || new.plan_key || ':'
        || coalesce(new.current_period_end::text, now()::text),
      jsonb_build_object(
        'tenant_id', new.tenant_id,
        'slug', v_tenant.slug,
        'business_name', coalesce(v_tenant.business_name ->> 'en', (select value from jsonb_each_text(v_tenant.business_name) limit 1), v_tenant.slug),
        'from_plan_key', v_old.key,
        'from_plan_name', coalesce(v_old.name ->> 'en', v_old.key),
        'to_plan_key', v_new.key,
        'to_plan_name', coalesce(v_new.name ->> 'en', v_new.key),
        'upgraded_at', now()
      )
    );
  exception when others then
    -- Never let a notification problem undo the order, signup or payment.
    raise warning '%: notification skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;

create trigger notify_subscription_upgraded
  after update of plan_key, status on public.subscriptions
  for each row execute function app.notify_subscription_upgraded();
