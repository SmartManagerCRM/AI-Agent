-- Real payment providers (Moyasar, Tap) + Cash on Delivery / Pay on Table.
--
-- Credentials are per-tenant (each business connects its own Moyasar/Tap
-- merchant account — money goes straight to that business, never pools in
-- one platform account) in a new, more tightly-gated table than
-- `tenant_settings`: `settings.read` (granted to plain staff) is enough to
-- see checkout config, but a payment gateway's secret key is sensitive
-- enough that only `settings.write` (business_owner/business_admin) may
-- even read it back — RLS is row-level, so this genuinely needs its own
-- table rather than a new tenant_settings column.
--
-- Cash on Delivery and Pay on Table are not payment gateways at all — no
-- external API call, no webhook. Choosing one at checkout means "the
-- customer will pay in person later": the order is created directly as
-- `confirmed` (skipping `pending_payment`) and a `payments` row is created
-- with status `pending`, meaning "awaiting collection" rather than
-- "awaiting an online payment attempt" — staff mark it collected later via
-- `mark_cash_payment_collected`, independent of the order's own
-- preparing/ready/completed lifecycle.

create table public.tenant_payment_config (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled_methods text[] not null default '{}'
    check (enabled_methods <@ array['moyasar', 'tap', 'cash_on_delivery', 'pay_on_table']),
  moyasar_secret_key text,
  tap_secret_key text,
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.tenant_payment_config
  for each row execute function app.set_updated_at();

alter table public.tenant_payment_config enable row level security;
alter table public.tenant_payment_config force row level security;
-- Deliberately settings.write (not settings.read) for SELECT too — plain
-- staff can see checkout config but not payment gateway secret keys.
create policy tenant_payment_config_select on public.tenant_payment_config
  for select using (app.has_permission(tenant_id, 'settings.write') or app.is_super_admin());
create policy tenant_payment_config_update on public.tenant_payment_config
  for update using (app.has_permission(tenant_id, 'settings.write'))
  with check (app.has_permission(tenant_id, 'settings.write'));
-- No insert/delete policy — the row is seeded once by create_business,
-- like tenant_settings/tenant_counters.

alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('mock', 'moyasar', 'tap', 'cash_on_delivery', 'pay_on_table'));

-- The customer's chosen payment method, set at checkout alongside
-- fulfillment_type. Read directly from the cart by create_order_from_cart
-- and (via orders.cart_id) by create_payment_attempt — never re-supplied
-- by application code, the same "the server derives it from what was
-- actually stored" discipline fulfillment_type already follows.
alter table public.carts add column payment_method text
  check (payment_method in ('moyasar', 'tap', 'cash_on_delivery', 'pay_on_table'));

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
  insert into public.tenant_payment_config (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;

-- Backfill: every tenant created before this migration needs a config row too.
insert into public.tenant_payment_config (tenant_id)
select id from public.tenants
on conflict (tenant_id) do nothing;

-- ── create_order_from_cart: now also gates on payment_method and branches
--    the initial order status by it. Everything else is unchanged from the
--    Phase 5 version. ─────────────────────────────────────────────────────
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
    currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor
  ) values (
    v_cart.tenant_id, v_order_number, v_cart.conversation_id, v_cart.id, v_initial_status, v_cart.fulfillment_type,
    v_cart.branch_id, v_cart.customer_name, v_cart.customer_phone, v_cart.customer_email, v_cart.delivery_address,
    v_cart.notes, v_currency, v_subtotal, v_delivery_fee, v_tax, v_subtotal + v_delivery_fee + v_tax
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

  update public.carts set status = 'converted' where id = p_cart_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_cart.tenant_id, auth.uid(), 'order.created', 'order', v_order_id);

  return v_order_id;
end;
$$;

-- ── create_payment_attempt: the provider is now derived server-side from
--    the order's own cart.payment_method — never re-asserted by the
--    caller. The mock provider keeps working for tests/dev by having a
--    cart's payment_method default through a direct insert in those paths
--    (see catalog-actions.ts / handlers.ts changes); this function no
--    longer accepts a provider argument at all. ─────────────────────────
drop function if exists public.create_payment_attempt(uuid, text);

create or replace function public.create_payment_attempt(p_order_id uuid)
returns table (payment_id uuid, provider text, order_number int, amount_minor bigint, currency text, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_provider text;
  v_existing public.payments%rowtype;
  v_payment_id uuid;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if auth.uid() is not null and not app.has_permission(v_order.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;

  select c.payment_method into v_provider from public.carts c where c.id = v_order.cart_id;
  if v_provider is null then
    raise exception 'VALIDATION_ERROR: order has no payment method on record';
  end if;

  if v_provider in ('cash_on_delivery', 'pay_on_table') then
    if v_order.status <> 'confirmed' then
      raise exception 'VALIDATION_ERROR: order is not awaiting a cash payment record';
    end if;
  else
    if v_order.status <> 'pending_payment' then
      raise exception 'VALIDATION_ERROR: order is not awaiting payment';
    end if;
  end if;

  select * into v_existing from public.payments
    where order_id = p_order_id and status in ('pending', 'succeeded')
    order by created_at desc limit 1;
  if found then
    return query select v_existing.id, v_existing.provider, v_order.order_number, v_existing.amount_minor, v_existing.currency::text, true;
    return;
  end if;

  -- The amount is the order's own total, re-read here — never supplied by
  -- the caller (spec §15's "backend computes the total" discipline applies
  -- to payments too: an amount is only ever what create_order_from_cart
  -- already computed and stored).
  insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
  values (v_order.tenant_id, p_order_id, v_provider, v_order.total_minor, v_order.currency, 'pending')
  returning id into v_payment_id;

  return query select v_payment_id, v_provider, v_order.order_number, v_order.total_minor, v_order.currency::text, false;
end;
$$;
revoke all on function public.create_payment_attempt(uuid) from public;
grant execute on function public.create_payment_attempt(uuid) to authenticated, service_role;

-- ── mark_cash_payment_collected: the staff-facing counterpart to
--    mark_payment_succeeded/mark_payment_failed above, for the two
--    providers that were never verified by a webhook because there is no
--    external gateway to verify with — a human collected real cash or a
--    paid bill and says so here. Does not touch orders.status: the
--    order's own preparing/ready/completed lifecycle already runs
--    independently of payment collection (the order was confirmed at
--    creation time). ──────────────────────────────────────────────────
create or replace function public.mark_cash_payment_collected(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'NOT_FOUND: payment does not exist';
  end if;
  if not app.has_permission(v_payment.tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if v_payment.provider not in ('cash_on_delivery', 'pay_on_table') then
    raise exception 'VALIDATION_ERROR: this payment is not collected in person';
  end if;
  if v_payment.status <> 'pending' then
    raise exception 'VALIDATION_ERROR: payment % is already %', p_payment_id, v_payment.status;
  end if;

  update public.payments set status = 'succeeded' where id = p_payment_id;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_payment.tenant_id, auth.uid(), 'payment.cash_collected', 'payment', p_payment_id);
end;
$$;
revoke all on function public.mark_cash_payment_collected(uuid) from public;
grant execute on function public.mark_cash_payment_collected(uuid) to authenticated;
