-- Products & Services: every item editable, suspendable and deletable; Brain
-- findings priced in another currency reach the catalog as drafts to price.
--
--   1. products.source_price      the price as found ({amount, currency}) when the
--                                 Business Brain or a file listed it in a currency
--                                 other than the business's. The product is kept
--                                 as a draft until the owner sets their own price
--                                 (which clears it) — a product can never be live
--                                 with an unconfirmed foreign price.
--   2. bookable_services.archived_at
--                                 a deleted service: hidden from the console and
--                                 customers, kept for its booking history (and so
--                                 the Brain doesn't add it back).
--   3. Brain approvals            no longer revive a deleted service, and only
--                                 activate a product draft once it has a price in
--                                 the business's currency.
--   3b. create_manual_orders()   refuses a product whose price is still to be set
--   4. products.status 'suspended'
--                                 taken off sale by the owner — not shown to
--                                 customers, not re-activated by "Activate all
--                                 drafts" or by a Brain approval.
-- Deleting a product sets status 'archived' (order lines keep pointing at it).

-- ── 1. Foreign-currency price to confirm ──────────────────────────────────
alter table public.products add column source_price jsonb;
alter table public.products add constraint products_source_price_not_live
  check (source_price is null or status <> 'active');

-- ── 2. Deleted services ───────────────────────────────────────────────────
alter table public.bookable_services add column archived_at timestamptz;
alter table public.bookable_services add constraint bookable_services_archived_inactive
  check (archived_at is null or not is_active);

-- ── 3. Brain approval → catalog ───────────────────────────────────────────
create or replace function app.sync_brain_catalog_draft()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_amount text;
  v_currency text;
  v_tenant_currency text;
  v_exponent int;
  v_usable boolean;
begin
  begin
    if new.fact_key is null or new.entry_type not in ('product_candidate', 'service_candidate') then
      return null;
    end if;
    if new.status = 'approved' and new.is_active then
      if new.entry_type = 'product_candidate' then
        -- An approved (possibly corrected) price in the business's currency
        -- replaces the draft's; without one, a draft that still needs a
        -- price stays a draft.
        select t.currency, c.exponent into v_tenant_currency, v_exponent
        from public.tenants t join public.currencies c on c.code = t.currency where t.id = new.tenant_id;
        v_amount := new.content -> 'normalized' ->> 'amount';
        v_currency := upper(coalesce(new.content -> 'normalized' ->> 'currency', v_tenant_currency));
        v_usable := v_amount ~ '^\d+(\.\d+)?$' and v_currency = v_tenant_currency;
        update public.products set
          status = 'active',
          source_price = null,
          price_minor = case when v_usable then round(v_amount::numeric * 10 ^ v_exponent)::bigint else price_minor end
        where tenant_id = new.tenant_id and brain_fact_key = new.fact_key and source = 'brain' and status = 'draft'
          and (v_usable or source_price is null);
      else
        update public.bookable_services set is_active = true
        where tenant_id = new.tenant_id and brain_fact_key = new.fact_key and source = 'brain'
          and not is_active and archived_at is null;
      end if;
    elsif new.status in ('rejected', 'archived') then
      update public.products set status = 'archived'
      where tenant_id = new.tenant_id and brain_fact_key = new.fact_key and source = 'brain' and status = 'draft';
    end if;
  exception when others then
    raise warning '%: catalog draft not updated: %', tg_name, sqlerrm;
  end;
  return null;
end;
$function$;

-- ── 3b. Manual orders never sell a product that still needs its price ─────
-- (Same function as 20261002090000; the only change is the price check.)
create or replace function public.create_manual_orders(p_tenant_id uuid, p_orders jsonb, p_created_via text default 'manual')
returns table (order_id uuid, order_number integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_needs_price boolean;
  v_settings jsonb;
  v_currency char(3);
  v_rate int;
  v_included boolean;
  v_order jsonb;
  v_item jsonb;
  v_idx int := 0;
  v_count int;
  v_label text;
  v_fulfillment text;
  v_name text;
  v_phone text;
  v_notes text;
  v_address text;
  v_paid boolean;
  v_qty int;
  v_price bigint;
  v_status text;
  v_subtotal bigint;
  v_delivery bigint;
  v_tax bigint;
  v_total bigint;
  v_number int;
  v_id uuid;
begin
  if not app.has_permission(p_tenant_id, 'orders.write') then
    raise exception 'PERMISSION_ERROR: orders.write required' using errcode = '42501';
  end if;
  if p_created_via not in ('manual', 'bulk_import') then
    raise exception 'VALIDATION_ERROR: invalid order source';
  end if;
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'VALIDATION_ERROR: there are no orders to add';
  end if;
  v_count := jsonb_array_length(p_orders);
  if v_count > 200 then
    raise exception 'VALIDATION_ERROR: add at most 200 orders at a time';
  end if;

  select ts.checkout, t.currency into v_settings, v_currency
  from public.tenant_settings ts join public.tenants t on t.id = ts.tenant_id
  where ts.tenant_id = p_tenant_id;
  if not found then
    raise exception 'NOT_FOUND: business does not exist';
  end if;
  v_rate := coalesce((v_settings ->> 'tax_rate_bps')::int, 0);
  v_included := coalesce((v_settings ->> 'tax_included')::boolean, false);

  for v_order in select value from jsonb_array_elements(p_orders) loop
    v_idx := v_idx + 1;
    v_label := case when v_count > 1 then 'order ' || coalesce(nullif(btrim(v_order ->> 'ref'), ''), v_idx::text) || ': ' else '' end;

    v_fulfillment := coalesce(nullif(btrim(v_order ->> 'fulfillment_type'), ''), 'pickup');
    if v_fulfillment not in ('pickup', 'delivery', 'dine_in') then
      raise exception 'VALIDATION_ERROR: %fulfillment must be pickup, delivery or dine-in', v_label;
    end if;
    v_name := nullif(btrim(v_order ->> 'customer_name'), '');
    v_phone := nullif(btrim(v_order ->> 'customer_phone'), '');
    v_notes := nullif(btrim(v_order ->> 'notes'), '');
    v_address := nullif(btrim(v_order ->> 'delivery_address'), '');
    if length(v_name) > 120 or length(v_phone) > 40 or length(v_notes) > 1000 or length(v_address) > 500 then
      raise exception 'VALIDATION_ERROR: %a customer detail is too long', v_label;
    end if;
    if v_fulfillment = 'delivery' and v_address is null then
      raise exception 'VALIDATION_ERROR: %a delivery order needs a delivery address', v_label;
    end if;
    v_paid := coalesce(v_order ->> 'paid', 'false') in ('true', 't', '1', 'yes');

    if jsonb_typeof(v_order -> 'items') is distinct from 'array' or jsonb_array_length(v_order -> 'items') = 0 then
      raise exception 'VALIDATION_ERROR: %add at least one product', v_label;
    end if;
    if jsonb_array_length(v_order -> 'items') > 100 then
      raise exception 'VALIDATION_ERROR: %an order can have at most 100 lines', v_label;
    end if;

    -- Live prices from the catalog — never from the caller.
    v_subtotal := 0;
    for v_item in select value from jsonb_array_elements(v_order -> 'items') loop
      if coalesce(v_item ->> 'product_id', '') !~ '^[0-9a-fA-F-]{36}$' then
        raise exception 'VALIDATION_ERROR: %a product is not in your catalog', v_label;
      end if;
      if coalesce(v_item ->> 'quantity', '') !~ '^\d{1,3}$' or (v_item ->> 'quantity')::int < 1 then
        raise exception 'VALIDATION_ERROR: %quantities must be whole numbers from 1 to 999', v_label;
      end if;
      v_qty := (v_item ->> 'quantity')::int;
      select p.price_minor, p.status, p.source_price is not null into v_price, v_status, v_needs_price
      from public.products p where p.id = (v_item ->> 'product_id')::uuid and p.tenant_id = p_tenant_id;
      if not found or v_status = 'archived' then
        raise exception 'VALIDATION_ERROR: %a product is not in your catalog', v_label;
      end if;
      if v_needs_price then
        raise exception 'VALIDATION_ERROR: %a product still needs its price', v_label;
      end if;
      v_subtotal := v_subtotal + v_price * v_qty;
    end loop;

    v_delivery := case when v_fulfillment = 'delivery' then coalesce((v_settings ->> 'delivery_fee_minor')::bigint, 0) else 0 end;
    v_tax := case when v_rate > 0 and not v_included then ((v_subtotal + v_delivery) * v_rate) / 10000 else 0 end;
    v_total := v_subtotal + v_delivery + v_tax;

    update public.tenant_counters set next_order_number = next_order_number + 1
      where tenant_id = p_tenant_id
      returning next_order_number - 1 into v_number;
    if v_number is null then
      insert into public.tenant_counters (tenant_id, next_order_number) values (p_tenant_id, 1001)
        on conflict (tenant_id) do nothing;
      v_number := 1000;
    end if;

    insert into public.orders (
      tenant_id, order_number, status, fulfillment_type, customer_name, customer_phone, delivery_address, notes,
      currency, subtotal_minor, delivery_fee_minor, tax_minor, total_minor, created_via
    ) values (
      p_tenant_id, v_number, 'confirmed', v_fulfillment, v_name, v_phone,
      case when v_address is not null then jsonb_build_object('formatted', v_address) end, v_notes,
      v_currency, v_subtotal, v_delivery, v_tax, v_total, p_created_via
    )
    returning id into v_id;

    insert into public.order_items (tenant_id, order_id, product_id, product_name, unit_price_minor, quantity, total_minor)
    select p_tenant_id, v_id, p.id, p.name, p.price_minor, (x.value ->> 'quantity')::int, p.price_minor * (x.value ->> 'quantity')::int
    from jsonb_array_elements(v_order -> 'items') x
    join public.products p on p.id = (x.value ->> 'product_id')::uuid and p.tenant_id = p_tenant_id;

    insert into public.order_status_history (tenant_id, order_id, from_status, to_status, actor, note)
    values (p_tenant_id, v_id, null, 'confirmed', 'staff',
      case p_created_via when 'manual' then 'added manually' else 'added by bulk import' end);

    insert into public.payments (tenant_id, order_id, provider, amount_minor, currency, status)
    values (p_tenant_id, v_id, 'cash_on_delivery', v_total, v_currency, case when v_paid then 'succeeded' else 'pending' end);

    insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
    values (p_tenant_id, auth.uid(), 'order.created_manually', 'order', v_id);

    order_id := v_id;
    order_number := v_number;
    return next;
  end loop;
end;
$function$;

-- ── 4. Suspended products ─────────────────────────────────────────────────
alter table public.products drop constraint products_status_check;
alter table public.products add constraint products_status_check
  check (status in ('draft', 'active', 'suspended', 'archived'));
