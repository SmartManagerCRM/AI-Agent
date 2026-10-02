-- Business currency: chosen from the console header, prices converted.
--
--   1. currencies                 every MENA and major international currency
--                                 (ISO 4217 codes and minor-unit exponents)
--   2. tenant_currency_changes    each switch, with the full exchange-rate
--                                 snapshot used (rates per 1 USD), its source and
--                                 time — so the conversion is auditable and
--                                 reports can express older orders in the new
--                                 currency at the same rates
--   3. change_business_currency() one atomic switch: product and service prices,
--                                 the delivery fee and minimum order, fixed-amount
--                                 coupons, and drafts waiting for a price listed in
--                                 the new currency. Rates come from the server
--                                 (a public exchange-rate feed), never invented.
--                                 Past orders keep their own currency and totals.
--   4. tenants.currency           can change only through (3) — a direct update
--                                 would leave every price in the old currency.
--   5. order_fx_factor() + reports  dashboard, analytics, customers and coupon
--                                 totals convert orders placed in an earlier
--                                 currency, so sums never mix currencies.

-- ── 1. Currencies ─────────────────────────────────────────────────────────
insert into public.currencies (code, exponent, name) values
  -- Middle East & North Africa
  ('JOD', 3, '{"en": "Jordanian Dinar", "ar": "دينار أردني", "fr": "Dinar jordanien"}'),
  ('EGP', 2, '{"en": "Egyptian Pound", "ar": "جنيه مصري", "fr": "Livre égyptienne"}'),
  ('LBP', 2, '{"en": "Lebanese Pound", "ar": "ليرة لبنانية", "fr": "Livre libanaise"}'),
  ('SYP', 2, '{"en": "Syrian Pound", "ar": "ليرة سورية", "fr": "Livre syrienne"}'),
  ('IQD', 3, '{"en": "Iraqi Dinar", "ar": "دينار عراقي", "fr": "Dinar irakien"}'),
  ('LYD', 3, '{"en": "Libyan Dinar", "ar": "دينار ليبي", "fr": "Dinar libyen"}'),
  ('DZD', 2, '{"en": "Algerian Dinar", "ar": "دينار جزائري", "fr": "Dinar algérien"}'),
  ('MAD', 2, '{"en": "Moroccan Dirham", "ar": "درهم مغربي", "fr": "Dirham marocain"}'),
  ('SDG', 2, '{"en": "Sudanese Pound", "ar": "جنيه سوداني", "fr": "Livre soudanaise"}'),
  ('YER', 2, '{"en": "Yemeni Rial", "ar": "ريال يمني", "fr": "Rial yéménite"}'),
  ('ILS', 2, '{"en": "New Shekel", "ar": "شيكل جديد", "fr": "Nouveau shekel"}'),
  ('IRR', 2, '{"en": "Iranian Rial", "ar": "ريال إيراني", "fr": "Rial iranien"}'),
  ('MRU', 2, '{"en": "Mauritanian Ouguiya", "ar": "أوقية موريتانية", "fr": "Ouguiya mauritanien"}'),
  ('SOS', 2, '{"en": "Somali Shilling", "ar": "شلن صومالي", "fr": "Shilling somalien"}'),
  ('DJF', 0, '{"en": "Djiboutian Franc", "ar": "فرنك جيبوتي", "fr": "Franc djiboutien"}'),
  ('KMF', 0, '{"en": "Comorian Franc", "ar": "فرنك قمري", "fr": "Franc comorien"}'),
  -- International
  ('CHF', 2, '{"en": "Swiss Franc", "ar": "فرنك سويسري", "fr": "Franc suisse"}'),
  ('JPY', 0, '{"en": "Japanese Yen", "ar": "ين ياباني", "fr": "Yen japonais"}'),
  ('CNY', 2, '{"en": "Chinese Yuan", "ar": "يوان صيني", "fr": "Yuan chinois"}'),
  ('HKD', 2, '{"en": "Hong Kong Dollar", "ar": "دولار هونغ كونغ", "fr": "Dollar de Hong Kong"}'),
  ('SGD', 2, '{"en": "Singapore Dollar", "ar": "دولار سنغافوري", "fr": "Dollar de Singapour"}'),
  ('INR', 2, '{"en": "Indian Rupee", "ar": "روبية هندية", "fr": "Roupie indienne"}'),
  ('PKR', 2, '{"en": "Pakistani Rupee", "ar": "روبية باكستانية", "fr": "Roupie pakistanaise"}'),
  ('BDT', 2, '{"en": "Bangladeshi Taka", "ar": "تاكا بنغلاديشية", "fr": "Taka bangladais"}'),
  ('LKR', 2, '{"en": "Sri Lankan Rupee", "ar": "روبية سريلانكية", "fr": "Roupie srilankaise"}'),
  ('NPR', 2, '{"en": "Nepalese Rupee", "ar": "روبية نيبالية", "fr": "Roupie népalaise"}'),
  ('AFN', 2, '{"en": "Afghan Afghani", "ar": "أفغاني", "fr": "Afghani"}'),
  ('IDR', 2, '{"en": "Indonesian Rupiah", "ar": "روبية إندونيسية", "fr": "Roupie indonésienne"}'),
  ('MYR', 2, '{"en": "Malaysian Ringgit", "ar": "رينغيت ماليزي", "fr": "Ringgit malaisien"}'),
  ('THB', 2, '{"en": "Thai Baht", "ar": "بات تايلندي", "fr": "Baht thaïlandais"}'),
  ('PHP', 2, '{"en": "Philippine Peso", "ar": "بيزو فلبيني", "fr": "Peso philippin"}'),
  ('VND', 0, '{"en": "Vietnamese Dong", "ar": "دونغ فيتنامي", "fr": "Dông vietnamien"}'),
  ('KRW', 0, '{"en": "South Korean Won", "ar": "وون كوري جنوبي", "fr": "Won sud-coréen"}'),
  ('TWD', 2, '{"en": "New Taiwan Dollar", "ar": "دولار تايواني جديد", "fr": "Nouveau dollar de Taïwan"}'),
  ('AUD', 2, '{"en": "Australian Dollar", "ar": "دولار أسترالي", "fr": "Dollar australien"}'),
  ('NZD', 2, '{"en": "New Zealand Dollar", "ar": "دولار نيوزيلندي", "fr": "Dollar néo-zélandais"}'),
  ('CAD', 2, '{"en": "Canadian Dollar", "ar": "دولار كندي", "fr": "Dollar canadien"}'),
  ('MXN', 2, '{"en": "Mexican Peso", "ar": "بيزو مكسيكي", "fr": "Peso mexicain"}'),
  ('BRL', 2, '{"en": "Brazilian Real", "ar": "ريال برازيلي", "fr": "Réal brésilien"}'),
  ('ARS', 2, '{"en": "Argentine Peso", "ar": "بيزو أرجنتيني", "fr": "Peso argentin"}'),
  ('CLP', 0, '{"en": "Chilean Peso", "ar": "بيزو تشيلي", "fr": "Peso chilien"}'),
  ('COP', 2, '{"en": "Colombian Peso", "ar": "بيزو كولومبي", "fr": "Peso colombien"}'),
  ('PEN', 2, '{"en": "Peruvian Sol", "ar": "سول بيروفي", "fr": "Sol péruvien"}'),
  ('ZAR', 2, '{"en": "South African Rand", "ar": "راند جنوب أفريقي", "fr": "Rand sud-africain"}'),
  ('NGN', 2, '{"en": "Nigerian Naira", "ar": "نايرا نيجيرية", "fr": "Naira nigérian"}'),
  ('KES', 2, '{"en": "Kenyan Shilling", "ar": "شلن كيني", "fr": "Shilling kényan"}'),
  ('GHS', 2, '{"en": "Ghanaian Cedi", "ar": "سيدي غاني", "fr": "Cedi ghanéen"}'),
  ('ETB', 2, '{"en": "Ethiopian Birr", "ar": "بير إثيوبي", "fr": "Birr éthiopien"}'),
  ('TZS', 2, '{"en": "Tanzanian Shilling", "ar": "شلن تنزاني", "fr": "Shilling tanzanien"}'),
  ('UGX', 0, '{"en": "Ugandan Shilling", "ar": "شلن أوغندي", "fr": "Shilling ougandais"}'),
  ('XOF', 0, '{"en": "West African CFA Franc", "ar": "فرنك غرب أفريقي", "fr": "Franc CFA (BCEAO)"}'),
  ('XAF', 0, '{"en": "Central African CFA Franc", "ar": "فرنك وسط أفريقي", "fr": "Franc CFA (BEAC)"}'),
  ('RUB', 2, '{"en": "Russian Ruble", "ar": "روبل روسي", "fr": "Rouble russe"}'),
  ('UAH', 2, '{"en": "Ukrainian Hryvnia", "ar": "هريفنيا أوكرانية", "fr": "Hryvnia ukrainienne"}'),
  ('PLN', 2, '{"en": "Polish Zloty", "ar": "زلوتي بولندي", "fr": "Zloty polonais"}'),
  ('CZK', 2, '{"en": "Czech Koruna", "ar": "كورونا تشيكية", "fr": "Couronne tchèque"}'),
  ('HUF', 2, '{"en": "Hungarian Forint", "ar": "فورنت مجري", "fr": "Forint hongrois"}'),
  ('RON', 2, '{"en": "Romanian Leu", "ar": "ليو روماني", "fr": "Leu roumain"}'),
  ('SEK', 2, '{"en": "Swedish Krona", "ar": "كرونة سويدية", "fr": "Couronne suédoise"}'),
  ('NOK', 2, '{"en": "Norwegian Krone", "ar": "كرونة نرويجية", "fr": "Couronne norvégienne"}'),
  ('DKK', 2, '{"en": "Danish Krone", "ar": "كرونة دنماركية", "fr": "Couronne danoise"}'),
  ('ISK', 0, '{"en": "Icelandic Krona", "ar": "كرونة آيسلندية", "fr": "Couronne islandaise"}'),
  ('AZN', 2, '{"en": "Azerbaijani Manat", "ar": "مانات أذربيجاني", "fr": "Manat azerbaïdjanais"}'),
  ('KZT', 2, '{"en": "Kazakhstani Tenge", "ar": "تينغ كازاخستاني", "fr": "Tenge kazakh"}'),
  ('UZS', 2, '{"en": "Uzbekistani Som", "ar": "سوم أوزبكي", "fr": "Sum ouzbek"}'),
  ('GEL', 2, '{"en": "Georgian Lari", "ar": "لاري جورجي", "fr": "Lari géorgien"}'),
  ('AMD', 2, '{"en": "Armenian Dram", "ar": "درام أرميني", "fr": "Dram arménien"}')
on conflict (code) do nothing;

-- ── 2. Switch history (with the rates used) ───────────────────────────────
create table public.tenant_currency_changes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_currency char(3) not null references public.currencies(code),
  to_currency char(3) not null references public.currencies(code),
  -- 1 unit of from_currency = rate units of to_currency
  rate numeric not null check (rate > 0),
  -- Units of each currency per 1 USD, as published by the source at rates_as_of.
  usd_rates jsonb not null,
  rate_source text not null,
  rates_as_of timestamptz,
  converted jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);
create index tenant_currency_changes_tenant_idx on public.tenant_currency_changes (tenant_id, changed_at desc);
alter table public.tenant_currency_changes enable row level security;
alter table public.tenant_currency_changes force row level security;
create policy tenant_currency_changes_select on public.tenant_currency_changes
  for select using (app.has_permission(tenant_id, 'settings.read') or app.is_super_admin());
-- No insert/update/delete policy: written only by change_business_currency().

-- ── 4. Currency changes only through the converting switch ────────────────
create or replace function app.guard_tenant_currency()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.currency is distinct from old.currency
     and coalesce(current_setting('app.currency_switch', true), '') <> 'on' then
    raise exception 'VALIDATION_ERROR: change the currency from the console header so prices are converted'
      using errcode = '23514';
  end if;
  return new;
end;
$function$;
create trigger guard_tenant_currency before update of currency on public.tenants
  for each row execute function app.guard_tenant_currency();

-- ── 3. The switch ─────────────────────────────────────────────────────────
create or replace function public.change_business_currency(
  p_tenant_id uuid,
  p_currency text,
  p_usd_rates jsonb,
  p_rate_source text,
  p_rates_as_of timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_from text;
  v_to text := upper(btrim(coalesce(p_currency, '')));
  v_from_exp int;
  v_to_exp int;
  v_from_usd numeric;
  v_to_usd numeric;
  v_rate numeric;
  v_factor numeric;
  v_products int;
  v_priced int;
  v_services int;
  v_coupons int;
  v_checkout jsonb;
  v_converted jsonb;
begin
  if not app.has_permission(p_tenant_id, 'settings.write') then
    raise exception 'PERMISSION_ERROR: settings.write required' using errcode = '42501';
  end if;
  select t.currency into v_from from public.tenants t where t.id = p_tenant_id for update;
  if not found then
    raise exception 'NOT_FOUND: business does not exist';
  end if;
  select exponent into v_to_exp from public.currencies where code = v_to;
  if not found then
    raise exception 'VALIDATION_ERROR: unknown currency %', v_to;
  end if;
  if v_to = v_from then
    return jsonb_build_object('currency', v_to, 'changed', false);
  end if;
  select exponent into v_from_exp from public.currencies where code = v_from;
  if jsonb_typeof(p_usd_rates) <> 'object' or coalesce(btrim(p_rate_source), '') = '' then
    raise exception 'VALIDATION_ERROR: exchange rates are required';
  end if;
  v_from_usd := case when jsonb_typeof(p_usd_rates -> v_from) = 'number' then (p_usd_rates ->> v_from)::numeric end;
  v_to_usd := case when jsonb_typeof(p_usd_rates -> v_to) = 'number' then (p_usd_rates ->> v_to)::numeric end;
  if v_from_usd is null or v_to_usd is null or v_from_usd <= 0 or v_to_usd <= 0 then
    raise exception 'VALIDATION_ERROR: no exchange rate between % and %', v_from, v_to;
  end if;
  v_rate := v_to_usd / v_from_usd;
  -- minor units of the old currency → minor units of the new one
  v_factor := v_rate * power(10::numeric, v_to_exp - v_from_exp);

  -- Every price converted (drafts still waiting for the owner's price have none yet).
  update public.products p
  set price_minor = round(p.price_minor * v_factor)::bigint
  where p.tenant_id = p_tenant_id and p.source_price is null;
  get diagnostics v_products = row_count;

  -- Drafts waiting for a price listed in the new currency now have it — exactly as listed, not converted.
  update public.products p
  set price_minor = round((p.source_price ->> 'amount')::numeric * power(10::numeric, v_to_exp))::bigint,
      source_price = null
  where p.tenant_id = p_tenant_id
    and upper(p.source_price ->> 'currency') = v_to
    and (p.source_price ->> 'amount') ~ '^\d+(\.\d+)?$';
  get diagnostics v_priced = row_count;

  update public.bookable_services s
  set price_minor = round(s.price_minor * v_factor)::bigint
  where s.tenant_id = p_tenant_id and s.price_minor is not null;
  get diagnostics v_services = row_count;

  update public.coupons c
  set discount_value = case when c.discount_type = 'fixed' then greatest(1, round(c.discount_value * v_factor))::bigint else c.discount_value end,
      min_order_minor = round(c.min_order_minor * v_factor)::bigint
  where c.tenant_id = p_tenant_id;
  get diagnostics v_coupons = row_count;

  select ts.checkout into v_checkout from public.tenant_settings ts where ts.tenant_id = p_tenant_id for update;
  if v_checkout is not null then
    if jsonb_typeof(v_checkout -> 'delivery_fee_minor') = 'number' then
      v_checkout := jsonb_set(v_checkout, '{delivery_fee_minor}', to_jsonb(round((v_checkout ->> 'delivery_fee_minor')::numeric * v_factor)::bigint));
    end if;
    if jsonb_typeof(v_checkout -> 'minimum_order_minor') = 'number' then
      v_checkout := jsonb_set(v_checkout, '{minimum_order_minor}', to_jsonb(round((v_checkout ->> 'minimum_order_minor')::numeric * v_factor)::bigint));
    end if;
    update public.tenant_settings set checkout = v_checkout where tenant_id = p_tenant_id;
  end if;

  perform set_config('app.currency_switch', 'on', true);
  update public.tenants set currency = v_to where id = p_tenant_id;
  perform set_config('app.currency_switch', 'off', true);

  v_converted := jsonb_build_object('products', v_products, 'priced_from_listing', v_priced, 'services', v_services, 'coupons', v_coupons);
  insert into public.tenant_currency_changes
    (tenant_id, from_currency, to_currency, rate, usd_rates, rate_source, rates_as_of, converted, changed_by)
  values (p_tenant_id, v_from, v_to, v_rate, p_usd_rates, left(p_rate_source, 200), p_rates_as_of, v_converted, auth.uid());
  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'business.currency_changed', 'tenant', p_tenant_id,
    jsonb_build_object('from', v_from, 'to', v_to, 'rate', v_rate, 'source', p_rate_source, 'rates_as_of', p_rates_as_of) || v_converted);

  return jsonb_build_object('currency', v_to, 'changed', true, 'from', v_from, 'rate', v_rate) || v_converted;
end;
$function$;
revoke all on function public.change_business_currency(uuid, text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.change_business_currency(uuid, text, jsonb, text, timestamptz) to authenticated;

-- ── 5. Reports in one currency ────────────────────────────────────────────
-- Multiplier turning an amount in minor units of p_currency into minor
-- units of the business's current currency: 1 for its own currency; for an
-- earlier one, the rates saved by the latest switch that covers both.
create or replace function public.order_fx_factor(p_tenant_id uuid, p_currency text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_currency = t.currency then 1::numeric
    else coalesce(
      (select (c.usd_rates ->> t.currency)::numeric / nullif((c.usd_rates ->> p_currency)::numeric, 0)
       from public.tenant_currency_changes c
       where c.tenant_id = p_tenant_id
         and jsonb_typeof(c.usd_rates -> p_currency) = 'number'
         and jsonb_typeof(c.usd_rates -> t.currency::text) = 'number'
       order by c.changed_at desc
       limit 1),
      1::numeric
    ) * power(10::numeric, tc.exponent - coalesce(fc.exponent, tc.exponent))
  end
  from public.tenants t
  join public.currencies tc on tc.code = t.currency
  left join public.currencies fc on fc.code = p_currency
  where t.id = p_tenant_id
    -- Only for people who may read this business's orders (the reports' own audience).
    and (app.has_permission(p_tenant_id, 'orders.read') or app.is_super_admin());
$function$;
revoke all on function public.order_fx_factor(uuid, text) from public, anon;
grant execute on function public.order_fx_factor(uuid, text) to authenticated, service_role;

-- The four money reports, unchanged except that each order's amounts are
-- converted into the business's current currency first.
create or replace function public.tenant_dashboard_stats(p_tenant_id uuid, p_locale text, p_window_days integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with fx as (
    -- Orders placed in an earlier currency, expressed in today's (see public.order_fx_factor).
    select c.currency, public.order_fx_factor(p_tenant_id, c.currency::text) as f
    from (select distinct currency from public.orders where tenant_id = p_tenant_id) c
  ),
  o as (
    select
      round(ord.total_minor * coalesce(fx.f, 1))::bigint as total_minor,
      ord.status,
      ord.created_at,
      nullif(coalesce(ord.customer_email::text, ord.customer_phone, ord.customer_name), '') as customer_key
    from public.orders ord left join fx on fx.currency = ord.currency
    where ord.tenant_id = p_tenant_id
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
          sum(round(oi.total_minor * coalesce(fx.f, 1)))::bigint as revenue_minor
        from public.order_items oi
        join public.orders ord on ord.id = oi.order_id
        left join fx on fx.currency = ord.currency
        where oi.tenant_id = p_tenant_id
        group by 1
        order by 3 desc, 1
        limit 5
      ) p
    ), '[]'::jsonb)
  )
  from totals t;
$$;

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
  with fx as (
    -- Orders placed in an earlier currency, expressed in today's (see public.order_fx_factor).
    select c.currency, public.order_fx_factor(p_tenant_id, c.currency::text) as f
    from (select distinct currency from public.orders where tenant_id = p_tenant_id) c
  ),
  o as (
    select
      coalesce(ord.customer_email::text, ord.customer_phone, ord.customer_name, 'unknown') as customer_key,
      ord.customer_name,
      ord.customer_email::text as customer_email,
      ord.customer_phone,
      round(ord.total_minor * coalesce(fx.f, 1))::bigint as total_minor,
      ord.created_at
    from public.orders ord left join fx on fx.currency = ord.currency
    where ord.tenant_id = p_tenant_id
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

create or replace function public.tenant_coupon_discount_total(p_tenant_id uuid)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(round(o.discount_minor * public.order_fx_factor(p_tenant_id, o.currency::text))), 0)::bigint
  from public.orders o
  where o.tenant_id = p_tenant_id and o.coupon_id is not null;
$$;
