-- Marketing: coupon codes (spec Phase 5's "Marketing" — a real feature,
-- not a UI shell over data that doesn't exist). A coupon is tenant-scoped,
-- redeemed by code at checkout, and its eligibility/discount math lives in
-- exactly one place: `validate_coupon` below. `create_order_from_cart`
-- calls that same function rather than re-implementing the math, so a
-- live checkout preview and the actual, atomic redemption can never drift
-- out of agreement with each other (the same discipline this schema
-- already applies to order totals: spec §15).

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  code text not null check (char_length(code) between 2 and 40),
  description text,
  discount_type text not null check (discount_type in ('percentage', 'fixed')),
  -- percentage: basis points (100 = 1%), the same unit tax_rate_bps already
  -- uses. fixed: minor currency units, the same unit every *_minor column
  -- already uses.
  discount_value bigint not null check (discount_value > 0),
  min_order_minor bigint not null default 0 check (min_order_minor >= 0),
  usage_limit int check (usage_limit > 0),
  times_used int not null default 0 check (times_used >= 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (discount_type <> 'percentage' or discount_value <= 10000)
);
create unique index coupons_tenant_code_uidx on public.coupons (tenant_id, upper(code));
create index coupons_tenant_status_idx on public.coupons (tenant_id, status);
create trigger set_updated_at before update on public.coupons
  for each row execute function app.set_updated_at();

alter table public.coupons enable row level security;
alter table public.coupons force row level security;
create policy coupons_select on public.coupons
  for select using (app.has_permission(tenant_id, 'marketing.read') or app.is_super_admin());
create policy coupons_insert on public.coupons
  for insert with check (app.has_permission(tenant_id, 'marketing.write'));
create policy coupons_update on public.coupons
  for update using (app.has_permission(tenant_id, 'marketing.write'))
  with check (app.has_permission(tenant_id, 'marketing.write'));
-- No delete policy — a coupon is disabled (status), never deleted, so an
-- order that redeemed it keeps a valid, reportable coupon_id forever.

insert into public.permissions (key, module, description) values
  ('marketing.read', 'marketing', 'View coupons'),
  ('marketing.write', 'marketing', 'Create and manage coupons');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key in ('business_owner', 'business_admin')
  and p.key in ('marketing.read', 'marketing.write');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff' and p.key = 'marketing.read';

-- The code a customer entered at checkout — like fulfillment_type/
-- payment_method, set by the same commerce-service/tool path and only
-- ever validated for real inside create_order_from_cart.
alter table public.carts add column coupon_code text;

alter table public.orders add column coupon_id uuid references public.coupons(id) on delete set null;
alter table public.orders add column discount_minor bigint not null default 0 check (discount_minor >= 0);
alter table public.orders add constraint orders_discount_le_subtotal check (discount_minor <= subtotal_minor);

-- ── validate_coupon: the one place coupon eligibility and discount amount
--    are decided. `stable` (read-only, no side effect) so it's safe to call
--    for a live checkout preview; `create_order_from_cart` calls this same
--    function and is the only place a validated coupon is ever actually
--    applied (and times_used incremented). Callable by anon — a customer
--    already knows the code they're trying, and this reveals nothing about
--    the coupon beyond whether their own code works. ─────────────────────
create or replace function public.validate_coupon(p_tenant_id uuid, p_code text, p_subtotal_minor bigint)
returns table (valid boolean, message text, coupon_id uuid, discount_minor bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_coupon public.coupons%rowtype;
  v_discount bigint;
begin
  if p_code is null or trim(p_code) = '' then
    return query select false, 'Enter a code.', null::uuid, 0::bigint;
    return;
  end if;

  select * into v_coupon from public.coupons
    where tenant_id = p_tenant_id and upper(code) = upper(trim(p_code));
  if not found then
    return query select false, 'This code is not valid.', null::uuid, 0::bigint;
    return;
  end if;
  if v_coupon.status <> 'active' then
    return query select false, 'This code is no longer active.', null::uuid, 0::bigint;
    return;
  end if;
  if v_coupon.starts_at is not null and now() < v_coupon.starts_at then
    return query select false, 'This code is not active yet.', null::uuid, 0::bigint;
    return;
  end if;
  if v_coupon.ends_at is not null and now() > v_coupon.ends_at then
    return query select false, 'This code has expired.', null::uuid, 0::bigint;
    return;
  end if;
  if v_coupon.usage_limit is not null and v_coupon.times_used >= v_coupon.usage_limit then
    return query select false, 'This code has already been fully redeemed.', null::uuid, 0::bigint;
    return;
  end if;
  if p_subtotal_minor < v_coupon.min_order_minor then
    return query select false, 'Your order does not meet the minimum required for this code.', null::uuid, 0::bigint;
    return;
  end if;

  v_discount := case
    when v_coupon.discount_type = 'percentage' then (p_subtotal_minor * v_coupon.discount_value) / 10000
    else v_coupon.discount_value
  end;
  v_discount := least(v_discount, p_subtotal_minor);

  return query select true, null::text, v_coupon.id, v_discount;
end;
$$;
revoke all on function public.validate_coupon(uuid, text, bigint) from public;
grant execute on function public.validate_coupon(uuid, text, bigint) to anon, authenticated, service_role;

-- ── create_order_from_cart: now also applies the cart's coupon_code, if
--    any, via validate_coupon — discount reduces the taxable subtotal,
--    same "tax on what was actually charged" logic the delivery fee
--    already gets. Everything else is unchanged from the previous
--    version. ────────────────────────────────────────────────────────────
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
  v_initial_status text;
  v_coupon_id uuid;
  v_discount bigint := 0;
  v_coupon_valid boolean;
  v_coupon_message text;
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
  if v_cart.payment_method is null then
    raise exception 'VALIDATION_ERROR: choose a payment method before placing the order';
  end if;
  if not exists (
    select 1 from public.tenant_payment_config
    where tenant_id = v_cart.tenant_id and v_cart.payment_method = any(enabled_methods)
  ) then
    raise exception 'VALIDATION_ERROR: % is not an available payment method for this business', v_cart.payment_method;
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

  if v_cart.coupon_code is not null then
    select valid, message, coupon_id, discount_minor
      into v_coupon_valid, v_coupon_message, v_coupon_id, v_discount
      from public.validate_coupon(v_cart.tenant_id, v_cart.coupon_code, v_subtotal);
    if not v_coupon_valid then
      raise exception 'VALIDATION_ERROR: %', v_coupon_message;
    end if;
  end if;

  if v_cart.fulfillment_type = 'delivery' then
    v_delivery_fee := coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0);
  end if;

  v_tax_rate_bps := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_tax_included := coalesce((v_settings ->> 'tax_included')::boolean, false);
  if v_tax_rate_bps > 0 and not v_tax_included then
    v_tax := (((v_subtotal - v_discount) + v_delivery_fee) * v_tax_rate_bps) / 10000;
  end if;

  update public.tenant_counters set next_order_number = next_order_number + 1
    where tenant_id = v_cart.tenant_id
    returning next_order_number - 1 into v_order_number;
  if v_order_number is null then
    insert into public.tenant_counters (tenant_id, next_order_number) values (v_cart.tenant_id, 1001)
      on conflict (tenant_id) do nothing;
    v_order_number := 1000;
  end if;

  -- Cash on Delivery / Pay on Table: no online payment step at all — the
  -- order is confirmed immediately and goes straight to the admin panel;
  -- the customer pays in person later (spec: current request).
  v_initial_status := case
    when v_cart.payment_method in ('cash_on_delivery', 'pay_on_table') then 'confirmed'
    else 'pending_payment'
  end;

  insert into public.orders (
    tenant_id, order_number, conversation_id, cart_id, status, fulfillment_type, branch_id,
    customer_name, customer_phone, customer_email, delivery_address, notes,
    currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor, coupon_id, discount_minor
  ) values (
    v_cart.tenant_id, v_order_number, v_cart.conversation_id, v_cart.id, v_initial_status, v_cart.fulfillment_type,
    v_cart.branch_id, v_cart.customer_name, v_cart.customer_phone, v_cart.customer_email, v_cart.delivery_address,
    v_cart.notes, v_currency, v_subtotal, v_delivery_fee, v_tax, (v_subtotal - v_discount) + v_delivery_fee + v_tax,
    v_coupon_id, v_discount
  )
  returning id into v_order_id;

  insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
  select v_cart.tenant_id, v_order_id, p.id, p.name, p.price_minor, ci.quantity, p.price_minor * ci.quantity
  from public.cart_items ci
  join public.products p on p.id = ci.product_id
  where ci.cart_id = p_cart_id;

  insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
  values (
    v_cart.tenant_id, v_order_id, null, v_initial_status,
    case when auth.uid() is null then 'customer' else 'staff' end,
    case when v_initial_status = 'confirmed' then 'pay via ' || v_cart.payment_method else null end
  );

  if v_coupon_id is not null then
    update public.coupons set times_used = times_used + 1 where id = v_coupon_id;
  end if;

  update public.carts set status = 'converted' where id = p_cart_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_cart.tenant_id, auth.uid(), 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$$;
