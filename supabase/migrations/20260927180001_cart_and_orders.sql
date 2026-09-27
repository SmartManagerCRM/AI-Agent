-- Phase 5 — Cart & Orders (spec §13, §15, §16). Carts belong to a
-- conversation (one active cart per conversation) since there is still no
-- customer account system — the same hashed-cookie session that identifies
-- a conversation (Phase 4) is what identifies its cart. Like
-- `conversations`, both tables are reachable only through the service-role
-- client (see `src/server/commerce/`), never through a client-facing RLS
-- write path — the agent's tools are the only door, and they run entirely
-- on the server (spec §14 "the LLM does NOT directly access the database").

alter table public.tenant_settings
  add column checkout jsonb not null default jsonb_build_object(
    'ordering_enabled', false,
    'fulfillment_types', jsonb_build_array('pickup'),
    'delivery_fee_minor', 0,
    'minimum_order_minor', 0,
    'tax_rate_bps', 0,
    'tax_included', false
  );

-- Per-tenant sequential, human-friendly order numbers (e.g. "1001"), not a
-- raw uuid — the same purpose `tenant_counters` serves in this product's
-- sibling project.
create table public.tenant_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  next_order_number integer not null default 1000
);

create table public.carts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null unique references public.conversations(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'converted', 'abandoned')),
  fulfillment_type text check (fulfillment_type in ('pickup', 'delivery')),
  branch_id uuid references public.branches(id) on delete set null,
  customer_name text,
  customer_phone text,
  customer_email citext,
  delivery_address jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.carts
  for each row execute function app.set_updated_at();
create index carts_tenant_idx on public.carts (tenant_id, status);

alter table public.carts enable row level security;
alter table public.carts force row level security;
create policy carts_select on public.carts
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());
-- No insert/update/delete policy — service-role only, same as conversations.

create table public.cart_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  cart_id uuid not null references public.carts(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cart_id, product_id)
);
create trigger set_updated_at before update on public.cart_items
  for each row execute function app.set_updated_at();
create index cart_items_cart_idx on public.cart_items (cart_id);

alter table public.cart_items enable row level security;
alter table public.cart_items force row level security;
create policy cart_items_select on public.cart_items
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_number integer not null,
  conversation_id uuid references public.conversations(id) on delete set null,
  cart_id uuid references public.carts(id) on delete set null,
  status text not null default 'draft' check (
    status in ('draft', 'pending_payment', 'paid', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled', 'refunded')
  ),
  fulfillment_type text not null check (fulfillment_type in ('pickup', 'delivery')),
  branch_id uuid references public.branches(id),
  customer_name text,
  customer_phone text,
  customer_email citext,
  delivery_address jsonb,
  notes text,
  currency char(3) not null references public.currencies(code),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  delivery_fee_minor bigint not null default 0 check (delivery_fee_minor >= 0),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  placed_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, order_number)
);
create trigger set_updated_at before update on public.orders
  for each row execute function app.set_updated_at();
create index orders_tenant_idx on public.orders (tenant_id, status, placed_at desc);
alter table public.orders add constraint orders_tenant_id_uidx unique (tenant_id, id);

alter table public.orders enable row level security;
alter table public.orders force row level security;
create policy orders_select on public.orders
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());
-- No insert policy — orders are only ever created by `create_order_from_cart`.
-- Status changes go through `update_order_status` below (also no direct
-- update policy), which enforces the transition table server-side.

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  -- Snapshot at order time — the product row can change or be archived later,
  -- the order's own record of what was actually sold must not.
  product_name jsonb not null,
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  quantity integer not null check (quantity > 0),
  total_minor bigint not null check (total_minor >= 0)
);
create index order_items_order_idx on public.order_items (order_id);

alter table public.order_items enable row level security;
alter table public.order_items force row level security;
create policy order_items_select on public.order_items
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());

create table public.order_status_history (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor text not null check (actor in ('customer', 'staff', 'system')),
  note text,
  at timestamptz not null default now()
);
create index order_status_history_order_idx on public.order_status_history (order_id, at);

alter table public.order_status_history enable row level security;
alter table public.order_status_history force row level security;
create policy order_status_history_select on public.order_status_history
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());

-- ── Permissions (new module) ─────────────────────────────────────────────
insert into public.permissions (key, module, description) values
  ('orders.read', 'orders', 'View carts and orders'),
  ('orders.write', 'orders', 'Change order status');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin')
  and p.key in ('orders.read', 'orders.write');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff' and p.key = 'orders.read';

-- ── create_order_from_cart: the one place a total is ever computed
--    (spec §15: "the final total must be calculated by backend code") ────
create or replace function public.create_order_from_cart(p_cart_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cart public.carts%rowtype;
  v_settings jsonb;
  v_order_id uuid;
  v_order_number int;
  v_subtotal bigint := 0;
  v_delivery_fee bigint := 0;
  v_tax bigint := 0;
  v_tax_rate_bps int;
  v_tax_included boolean;
  v_currency char(3);
  v_item record;
begin
  select * into v_cart from public.carts where id = p_cart_id;
  if not found then
    raise exception 'NOT_FOUND: cart does not exist';
  end if;
  if auth.uid() is not null and not app.has_permission(v_cart.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if v_cart.status <> 'active' then
    raise exception 'VALIDATION_ERROR: this cart is no longer active';
  end if;
  if v_cart.fulfillment_type is null then
    raise exception 'VALIDATION_ERROR: choose pickup or delivery before placing the order';
  end if;
  if not exists (select 1 from public.cart_items where cart_id = p_cart_id) then
    raise exception 'VALIDATION_ERROR: the cart is empty';
  end if;

  select ts.checkout, t.currency into strict v_settings, v_currency
  from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id
  where ts.tenant_id = v_cart.tenant_id;

  -- Live prices, re-read now — never trusted from anywhere the cart came from.
  for v_item in
    select ci.product_id, ci.quantity, p.price_minor
    from public.cart_items ci
    join public.products p on p.id = ci.product_id and p.tenant_id = v_cart.tenant_id
    where ci.cart_id = p_cart_id
  loop
    v_subtotal := v_subtotal + (v_item.price_minor * v_item.quantity);
  end loop;

  if v_cart.fulfillment_type = 'delivery' then
    v_delivery_fee := coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0);
  end if;

  v_tax_rate_bps := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_tax_included := coalesce((v_settings ->> 'tax_included')::boolean, false);
  if v_tax_rate_bps > 0 and not v_tax_included then
    v_tax := ((v_subtotal + v_delivery_fee) * v_tax_rate_bps) / 10000;
  end if;

  update public.tenant_counters set next_order_number = next_order_number + 1
    where tenant_id = v_cart.tenant_id
    returning next_order_number - 1 into v_order_number;
  if v_order_number is null then
    insert into public.tenant_counters (tenant_id, next_order_number) values (v_cart.tenant_id, 1001)
      on conflict (tenant_id) do nothing;
    v_order_number := 1000;
  end if;

  insert into public.orders (
    tenant_id, order_number, conversation_id, cart_id, status, fulfillment_type, branch_id,
    customer_name, customer_phone, customer_email, delivery_address, notes,
    currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor
  ) values (
    v_cart.tenant_id, v_order_number, v_cart.conversation_id, v_cart.id, 'pending_payment', v_cart.fulfillment_type,
    v_cart.branch_id, v_cart.customer_name, v_cart.customer_phone, v_cart.customer_email, v_cart.delivery_address,
    v_cart.notes, v_currency, v_subtotal, v_delivery_fee, v_tax, v_subtotal + v_delivery_fee + v_tax
  )
  returning id into v_order_id;

  insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
  select v_cart.tenant_id, v_order_id, p.id, p.name, p.price_minor, ci.quantity, p.price_minor * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = p_cart_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor)
  values (v_cart.tenant_id, v_order_id, null, 'pending_payment', case when auth.uid() is null then 'customer' else 'staff' end);

  update public.carts set status = 'converted' where id = p_cart_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_cart.tenant_id, auth.uid(), 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$$;
revoke all on function public.create_order_from_cart(uuid) from public;
grant execute on function public.create_order_from_cart(uuid) to authenticated, service_role;

-- ── update_order_status: the one place a status transition happens ──────
create or replace function public.update_order_status(p_order_id uuid, p_new_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
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

  v_allowed := case v_row.status
    when 'draft' then array['pending_payment', 'cancelled']
    when 'pending_payment' then array['paid', 'cancelled']
    when 'paid' then array['confirmed', 'refunded']
    when 'confirmed' then array['preparing', 'cancelled']
    when 'preparing' then array['ready', 'cancelled']
    when 'ready' then array['completed', 'cancelled']
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
$$;
revoke all on function public.update_order_status(uuid, text, text) from public;
grant execute on function public.update_order_status(uuid, text, text) to authenticated;

-- ── create_business now also seeds this tenant's order-number counter.
--    Doing it here, at tenant creation, avoids a first-order race in
--    create_order_from_cart (two concurrent first orders both finding no
--    counter row and both trying to seed + use order_number 1000).
create or replace function public.create_business(
  p_business_name jsonb,
  p_business_type_key text,
  p_slug text,
  p_default_language text,
  p_currency char(3)
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_tenant_id uuid;
  v_owner_role_id uuid;
begin
  if v_user is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency)
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;
