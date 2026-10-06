-- Plan limits (branches, paid AI responses) and order receipts.
--
-- 1. Plans get two limits, set in Super Admin → Subscriptions & Plans:
--      max_branches        most active branches a business on the plan may
--                          have (null: no limit). Enforced in the database:
--                          adding (or re-activating) a branch past it fails
--                          with BRANCH_LIMIT. Branches already over it stay.
--      ai_response_limit   paid AI (LLM) responses a month (null: no limit).
--                          Like the AI cost cap: once used up, the Agent keeps
--                          answering with its deterministic replies only
--                          (catalog, cart, checkout, orders keep working).
--    The website's pricing shows the branch limit; subscribers see only the
--    share of their AI responses used, never a count or a cost.
-- 2. Every order gets a receipt (created when the order is, refreshed when
--    its details change): order lines and totals, the customer, and the
--    business's legal details (name, branch, address, phone, VAT number).
--    The business chooses whether it prints automatically or on a click.

-- ── 1. Plan limits ──────────────────────────────────────────────────────
alter table public.subscription_plans
  add column max_branches integer check (max_branches is null or max_branches > 0),
  add column ai_response_limit integer check (ai_response_limit is null or ai_response_limit > 0);

-- The website's plans, now with their branch limit (still no costs or AI limits).
drop function public.public_subscription_plans();
create function public.public_subscription_plans()
returns table(
  key text, family text, name jsonb, description jsonb, features jsonb,
  price_minor bigint, currency text, exponent integer, billing_interval text,
  trial_days integer, conversation_limit integer, is_popular boolean, sort_order integer,
  max_branches integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.key, coalesce(p.plan_family, p.key), p.name, p.description, p.features,
         p.price_minor, p.currency::text, coalesce(cu.exponent, 2)::integer, p.billing_interval,
         p.trial_days, p.conversation_limit, p.is_popular, p.sort_order,
         p.max_branches
    from public.subscription_plans p
    left join public.currencies cu on cu.code = p.currency
   where p.is_active and p.is_public
   order by p.sort_order, p.billing_interval, p.key;
$$;
revoke all on function public.public_subscription_plans() from public;
grant execute on function public.public_subscription_plans() to anon, authenticated;

-- A business's branch limit: its plan's (null: none).
create or replace function app.tenant_branch_limit(p_tenant_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select p.max_branches
    from public.subscriptions s
    join public.subscription_plans p on p.key = s.plan_key
   where s.tenant_id = p_tenant_id;
$$;
revoke all on function app.tenant_branch_limit(uuid) from public, anon, authenticated;

-- Adding an active branch, or re-activating one, past the plan's limit is refused.
-- One business at a time (advisory lock), so two branches added together can't both slip in.
create or replace function app.enforce_branch_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_active integer;
begin
  if not new.is_active or (tg_op = 'UPDATE' and old.is_active) then
    return new;
  end if;
  v_limit := app.tenant_branch_limit(new.tenant_id);
  if v_limit is null then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('branch_limit:' || new.tenant_id::text, 0));
  select count(*)::int into v_active
    from public.branches b
   where b.tenant_id = new.tenant_id and b.is_active and b.id <> new.id;
  if v_active >= v_limit then
    raise exception 'BRANCH_LIMIT: this plan allows % active branch(es)', v_limit using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger enforce_branch_limit
  before insert or update of is_active on public.branches
  for each row execute function app.enforce_branch_limit();

-- A business's own branch allowance, for its console (active branches and the plan's limit).
create or replace function public.tenant_branch_allowance(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.is_tenant_member(p_tenant_id) or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: business access required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'limit', app.tenant_branch_limit(p_tenant_id),
    'active', (select count(*) from public.branches b where b.tenant_id = p_tenant_id and b.is_active)
  );
end;
$$;
revoke all on function public.tenant_branch_allowance(uuid) from public, anon;
grant execute on function public.tenant_branch_allowance(uuid) to authenticated;

-- Usage: paid AI responses counted in the period, next to the AI cost.
create or replace function app.usage_snapshot(p_tenant_id uuid, p_record boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_plan public.subscription_plans%rowtype;
  v_settings public.usage_settings%rowtype;
  v_now timestamptz := now();
  v_paid boolean;
  v_trial boolean;
  v_trial_end text;
  v_start timestamptz;
  v_end timestamptz;
  v_conv_limit integer;
  v_conv_used integer;
  v_reached timestamptz;
  v_grace timestamptz;
  v_conv_state text;
  v_ai_limit numeric;
  v_ai_used numeric;
  v_ai_reserved numeric;
  v_ai_calls integer;
  v_ai_state text;
  v_conv_pct numeric;
  v_warn_level integer;
  v_ai_pct numeric;
  v_state text;
  v_months integer;
  v_resp_limit integer;
  v_resp_used integer;
  v_resp_pct numeric;
  v_ai_reason text;
begin
  if p_record then
    select * into v_sub from public.subscriptions where tenant_id = p_tenant_id for update;
  else
    select * into v_sub from public.subscriptions where tenant_id = p_tenant_id;
  end if;
  if not found then
    return null;
  end if;
  select * into v_plan from public.subscription_plans where key = v_sub.plan_key;
  select * into v_settings from public.usage_settings where id;
  v_settings.conversation_warning_percents := coalesce(v_settings.conversation_warning_percents, array[70, 85, 95]);
  v_settings.ai_cost_warning_percent := coalesce(v_settings.ai_cost_warning_percent, 80);

  v_paid := v_sub.status = 'active' and (v_sub.current_period_end is null or v_sub.current_period_end > v_now);
  v_trial := v_sub.status = 'trialing';

  -- The period usage is counted in: the trial window, or the paid billing period.
  if v_trial then
    v_end := v_sub.trial_ends_at;
    v_start := v_sub.created_at;
    v_conv_limit := v_settings.trial_conversation_limit;
    v_ai_limit := v_settings.trial_ai_cost_limit_usd;
  else
    v_end := v_sub.current_period_end;
    v_start := coalesce(
      v_sub.current_period_start,
      v_sub.current_period_end - case v_plan.billing_interval when 'year' then interval '1 year' else interval '1 month' end,
      date_trunc('month', v_now)
    );
    -- An annual plan's limits are monthly: usage is counted in the month of the
    -- year that is running, from the subscription's day of the month (subscribed
    -- on 25 January → 25 Jan–25 Feb, 25 Feb–25 Mar, …), against the plan's
    -- monthly limits. Each month starts at zero (its own AI spend row too).
    if v_plan.billing_interval = 'year' and v_start <= v_now then
      v_months := (extract(year from age(v_now, v_start)) * 12 + extract(month from age(v_now, v_start)))::int;
      while v_months > 0 and v_start + make_interval(months => v_months) > v_now loop
        v_months := v_months - 1;
      end loop;
      while v_start + make_interval(months => v_months + 1) <= v_now loop
        v_months := v_months + 1;
      end loop;
      v_end := case when v_end is null then v_start + make_interval(months => v_months + 1)
                    else least(v_end, v_start + make_interval(months => v_months + 1)) end;
      v_start := v_start + make_interval(months => v_months);
    end if;
    v_conv_limit := coalesce(v_sub.conversation_limit_override, v_plan.conversation_limit);
    -- AI cost cap: subscriber override, else plan default.
    v_ai_limit := coalesce(
      (select l.limit_usd from public.ai_cost_limits l where l.tenant_id = p_tenant_id),
      (select l.limit_usd from public.ai_cost_limits l where l.plan_key = v_sub.plan_key)
    );
  end if;

  -- Paid AI (LLM) responses: the plan's monthly allowance, on a trial too.
  v_resp_limit := v_plan.ai_response_limit;

  -- Customer conversations in the period: one conversation = one session, however many messages.
  select count(*)::int into v_conv_used
  from public.conversations c
  where c.tenant_id = p_tenant_id and c.last_message_at >= v_start and (v_end is null or c.last_message_at < v_end);

  -- Paid AI responses in the period: replies the Agent's model wrote (never
  -- Business Brain analysis, never the premium voice).
  select count(*)::int into v_resp_used
  from public.agent_interactions i
  where i.tenant_id = p_tenant_id and i.handled_by = 'ai' and i.success
    and i.request_type not in ('brain_ingestion', 'voice_tts')
    and i.created_at >= v_start and (v_end is null or i.created_at < v_end);

  -- AI spend in the period. First use of a period: seed it from the
  -- interaction ledger (Agent AI calls only — never Business Brain analysis,
  -- never the premium voice, which is not part of the plan's AI cost cap).
  select u.ai_cost_usd, u.ai_calls into v_ai_used, v_ai_calls
  from public.ai_usage_periods u where u.tenant_id = p_tenant_id and u.period_start = v_start;
  if not found then
    select coalesce(sum(i.estimated_cost_usd), 0), count(*) filter (where i.handled_by = 'ai' and i.success)
      into v_ai_used, v_ai_calls
    from public.agent_interactions i
    where i.tenant_id = p_tenant_id and i.request_type not in ('brain_ingestion', 'voice_tts') and i.created_at >= v_start
      and (v_end is null or i.created_at < v_end);
    if p_record then
      insert into public.ai_usage_periods (tenant_id, period_start, ai_cost_usd, ai_calls)
      values (p_tenant_id, v_start, v_ai_used, v_ai_calls)
      on conflict (tenant_id, period_start) do nothing;
    end if;
  end if;
  select coalesce(sum(r.amount_usd), 0) into v_ai_reserved
  from public.ai_cost_reservations r
  where r.tenant_id = p_tenant_id and r.period_start = v_start and r.expires_at > v_now;

  if v_trial then
    -- No grace period on a trial: more than the trial's conversations, or
    -- its AI allowance used up, ends the trial (like the end date does).
    v_reached := null;
    v_grace := null;
    v_trial_end := case
      when v_sub.trial_ends_at <= v_now then 'expired'
      when v_conv_limit is not null and v_conv_used > v_conv_limit then 'conversation_limit'
      when v_ai_limit is not null and v_ai_used >= v_ai_limit then 'ai_cost_limit'
    end;
    v_conv_state := case when v_conv_limit is not null and v_conv_used > v_conv_limit then 'blocked' else 'ok' end;
    if p_record then
      if v_trial_end in ('conversation_limit', 'ai_cost_limit') and v_sub.trial_limit_reached_at is null then
        update public.subscriptions
          set trial_limit_reached_at = v_now, trial_limit_reason = v_trial_end
          where tenant_id = p_tenant_id;
        insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
        values (p_tenant_id, null, 'usage.trial_limit_reached', 'subscription', p_tenant_id,
          jsonb_build_object('reason', v_trial_end, 'conversations', v_conv_used, 'conversation_limit', v_conv_limit));
      elsif v_trial_end is distinct from 'conversation_limit' and v_trial_end is distinct from 'ai_cost_limit'
            and v_sub.trial_limit_reached_at is not null and v_sub.trial_ends_at > v_now then
        -- Super Admin raised the trial limits: the trial is back on.
        update public.subscriptions set trial_limit_reached_at = null, trial_limit_reason = null where tenant_id = p_tenant_id;
      end if;
    end if;
  else
    -- Paid: reaching the conversation limit starts a grace period.
    v_reached := case when v_sub.conversation_limit_reached_at >= v_start then v_sub.conversation_limit_reached_at end;
    v_grace := case when v_reached is not null then v_sub.conversation_limit_grace_until end;
    if not v_paid or v_conv_limit is null or v_conv_used < v_conv_limit then
      v_conv_state := 'ok';
      if p_record and v_sub.conversation_limit_reached_at is not null then
        update public.subscriptions
          set conversation_limit_reached_at = null, conversation_limit_grace_until = null
          where tenant_id = p_tenant_id;
      end if;
      v_reached := null;
      v_grace := null;
    else
      if v_reached is null then
        v_reached := v_now;
        v_grace := v_now + make_interval(hours => v_plan.grace_period_hours);
        if p_record then
          update public.subscriptions
            set conversation_limit_reached_at = v_reached, conversation_limit_grace_until = v_grace
            where tenant_id = p_tenant_id;
          insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
          values (p_tenant_id, null, 'usage.conversation_limit_reached', 'subscription', p_tenant_id,
            jsonb_build_object('limit', v_conv_limit, 'used', v_conv_used, 'grace_until', v_grace));
        end if;
      end if;
      v_conv_state := case when v_now < v_grace then 'grace' else 'blocked' end;
    end if;
  end if;

  -- AI is limited when the cost cap or the paid-response allowance is used up
  -- (the Agent then answers with its deterministic replies only).
  v_ai_reason := case
    when not (v_paid or v_trial) then null
    when v_ai_limit is not null and v_ai_used >= v_ai_limit then 'cost'
    when v_resp_limit is not null and v_resp_used >= v_resp_limit then 'responses'
  end;
  v_ai_state := case
    when not (v_paid or v_trial) then 'ok'
    when v_ai_reason is not null then 'blocked'
    when v_ai_limit is not null and v_ai_used >= v_ai_limit * v_settings.ai_cost_warning_percent / 100.0 then 'warning'
    when v_resp_limit is not null and v_resp_used >= v_resp_limit * v_settings.ai_cost_warning_percent / 100.0 then 'warning'
    else 'ok'
  end;
  v_resp_pct := case when v_resp_limit > 0 then round(100.0 * v_resp_used / v_resp_limit, 1) end;
  v_ai_pct := case when v_ai_limit > 0 then round(100.0 * v_ai_used / v_ai_limit, 1) when v_ai_limit = 0 then 100 end;

  -- Conversation warning level: 0, one of the configured percents, or 100.
  v_conv_pct := case when v_conv_limit > 0 then round(100.0 * v_conv_used / v_conv_limit, 1) end;
  v_warn_level := case
    when v_conv_pct is null then 0
    when v_conv_used >= v_conv_limit then 100
    else coalesce((select max(t) from unnest(v_settings.conversation_warning_percents) t where v_conv_pct >= t), 0)
  end;

  v_state := case
    when v_trial then case when v_trial_end is not null then 'TRIAL_ENDED' else 'TRIAL' end
    when not v_paid then 'NOT_ACTIVE'
    when v_conv_state <> 'ok' and v_ai_state = 'blocked' then 'BOTH_LIMITS_REACHED'
    when v_ai_state = 'blocked' then case v_ai_reason when 'responses' then 'AI_RESPONSE_LIMIT_REACHED' else 'AI_COST_LIMIT_REACHED' end
    when v_conv_state = 'blocked' then 'CONVERSATION_LIMIT_REACHED'
    when v_conv_state = 'grace' then 'CONVERSATION_GRACE_PERIOD'
    when v_ai_state = 'warning' then 'AI_COST_WARNING'
    when v_warn_level > 0 then 'CONVERSATION_WARNING'
    else 'ACTIVE'
  end;

  return jsonb_build_object(
    'is_paid', v_paid,
    'is_trial', v_trial,
    'trial_ended', v_trial_end is not null,
    'trial_end_reason', v_trial_end,
    'trial_ends_at', case when v_trial then v_sub.trial_ends_at end,
    'status', v_sub.status,
    'plan_key', v_sub.plan_key,
    'period_start', v_start,
    'period_end', v_end,
    'conversation_limit', v_conv_limit,
    'conversation_limit_default', case when v_trial then v_settings.trial_conversation_limit else v_plan.conversation_limit end,
    'conversation_limit_override', case when v_trial then null else v_sub.conversation_limit_override end,
    'conversations_used', v_conv_used,
    'conversation_percent', v_conv_pct,
    'conversation_warning_level', v_warn_level,
    'grace_period_hours', case when v_trial then 0 else v_plan.grace_period_hours end,
    'limit_reached_at', v_reached,
    'grace_until', v_grace,
    'conversation_state', v_conv_state,
    'ai_cost_limit', v_ai_limit,
    'ai_cost_used', v_ai_used,
    'ai_cost_reserved', v_ai_reserved,
    'ai_calls', v_ai_calls,
    'ai_cost_percent', v_ai_pct,
    'ai_state', v_ai_state,
    'ai_block_reason', v_ai_reason,
    'ai_response_limit', v_resp_limit,
    'ai_responses_used', v_resp_used,
    'ai_response_percent', v_resp_pct,
    'usage_state', v_state
  );
end;
$$;
revoke all on function app.usage_snapshot(uuid, boolean) from public, anon, authenticated;

-- What a subscriber sees: their conversations, whether AI is limited, and —
-- when the plan has an AI response allowance — only the share of it used
-- (a whole percent, at most 100): never a count, a limit or a cost.
create or replace function public.tenant_usage_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not app.has_permission(p_tenant_id, 'business.read') then
    raise exception 'PERMISSION_ERROR: business access required' using errcode = '42501';
  end if;
  v := app.usage_snapshot(p_tenant_id, true);
  if v is null then
    return null;
  end if;
  return (v - 'ai_cost_limit' - 'ai_cost_used' - 'ai_cost_reserved' - 'ai_calls' - 'ai_cost_percent' - 'ai_state'
            - 'usage_state' - 'conversation_limit_default' - 'conversation_limit_override' - 'trial_end_reason'
            - 'ai_block_reason' - 'ai_response_limit' - 'ai_responses_used' - 'ai_response_percent')
         || jsonb_build_object(
              'ai_limited', v ->> 'ai_state' = 'blocked',
              'trial_end_reason', case v ->> 'trial_end_reason' when 'ai_cost_limit' then 'usage_limit' else v ->> 'trial_end_reason' end,
              'ai_response_percent', case when v ->> 'ai_response_percent' is not null
                then least(100, floor((v ->> 'ai_response_percent')::numeric))::int end
            );
end;
$$;
revoke all on function public.tenant_usage_summary(uuid) from public, anon;
grant execute on function public.tenant_usage_summary(uuid) to authenticated;

-- ── 2. Receipts ─────────────────────────────────────────────────────────
-- The business's legal details, printed on its receipts.
alter table public.tenants
  add column legal_name text check (legal_name is null or length(legal_name) <= 160),
  add column vat_number text check (vat_number is null or length(vat_number) <= 40),
  add column address text check (address is null or length(address) <= 300);

-- Receipts print on a click (manual) or as soon as an order is confirmed (auto).
alter table public.tenant_settings
  add column receipt_print_mode text not null default 'manual' check (receipt_print_mode in ('manual', 'auto'));
-- tenant_settings is granted column by column (20261001150000_usage_governance): members read
-- the mode (the console prints automatically when it is 'auto'); settings.write changes it (RLS).
grant select (receipt_print_mode), update (receipt_print_mode) on public.tenant_settings to authenticated;

create table public.order_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_id uuid not null unique,
  receipt_number text not null,
  -- Unique per receipt, carried in its QR code.
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  issued_at timestamptz not null default now(),
  -- What the receipt shows: the order, its lines, the customer, the business.
  details jsonb not null,
  auto_printed_at timestamptz,
  print_count integer not null default 0,
  last_printed_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, order_id) references public.orders (tenant_id, id) on delete cascade
);
create index order_receipts_tenant_idx on public.order_receipts (tenant_id, issued_at desc);

alter table public.order_receipts enable row level security;
alter table public.order_receipts force row level security;
create policy order_receipts_select on public.order_receipts
  for select using (app.has_permission(tenant_id, 'orders.read') or app.is_super_admin());
-- No insert/update/delete policy: written only by the functions below.

-- Everything a receipt shows, read from the order as it is now.
create or replace function app.order_receipt_details(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'business', jsonb_build_object(
      'name', t.business_name,
      'legal_name', t.legal_name,
      'vat_number', t.vat_number,
      'address', t.address,
      'phone', t.contact_phone,
      'email', t.contact_email,
      'default_language', t.default_language
    ),
    'branch', case when b.id is not null
      then jsonb_build_object('name', b.name, 'address', b.address, 'phone', b.phone) end,
    'order', jsonb_build_object(
      'number', o.order_number,
      'placed_at', o.placed_at,
      'fulfillment_type', o.fulfillment_type,
      'currency', o.currency,
      'exponent', coalesce(cu.exponent, 2),
      'subtotal_minor', o.subtotal_minor,
      'discount_minor', o.discount_minor,
      'delivery_fee_minor', o.delivery_fee_minor,
      'tax_minor', o.tax_minor,
      'total_minor', o.total_minor,
      'payment_method', (select p.provider from public.payments p where p.order_id = o.id order by p.created_at desc limit 1),
      'table', (select bt.label from public.branch_tables bt where bt.id = o.table_id),
      'notes', o.notes
    ),
    'customer', jsonb_build_object(
      'name', o.customer_name,
      'phone', o.customer_phone,
      'email', o.customer_email,
      'address', coalesce(
        o.delivery_address ->> 'formatted',
        (select string_agg(a.value, ', ') from jsonb_each_text(coalesce(o.delivery_address, '{}'::jsonb)) a where a.value <> '')
      )
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', i.product_name, 'quantity', i.quantity,
               'unit_price_minor', i.unit_price_minor, 'total_minor', i.total_minor
             ) order by i.ctid)
        from public.order_items i where i.order_id = o.id
    ), '[]'::jsonb)
  )
  from public.orders o
  join public.tenants t on t.id = o.tenant_id
  left join public.currencies cu on cu.code = o.currency
  -- The order's branch, else the business's default branch.
  left join lateral (
    select br.* from public.branches br
     where br.tenant_id = o.tenant_id and (br.id = o.branch_id or (o.branch_id is null and br.is_default))
     limit 1
  ) b on true
  where o.id = p_order_id;
$$;
revoke all on function app.order_receipt_details(uuid) from public, anon, authenticated;

-- Creates the order's receipt (once) — deferred to commit, so its lines are there.
create or replace function app.create_order_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.order_receipts (tenant_id, order_id, receipt_number, details)
    select o.tenant_id, o.id, 'R-' || lpad(o.order_number::text, 6, '0'), app.order_receipt_details(o.id)
      from public.orders o
     where o.id = new.id
    on conflict (order_id) do nothing;
  exception when others then
    -- Never let a receipt problem undo the order (it is created on first use instead).
    raise warning '%: receipt skipped: %', tg_name, sqlerrm;
  end;
  return null;
end;
$$;
create constraint trigger create_order_receipt
  after insert on public.orders
  deferrable initially deferred
  for each row execute function app.create_order_receipt();

-- The order's details changed (customer, address, notes, status — a payment
-- recorded): the receipt shows them as they are now.
create or replace function app.refresh_order_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    update public.order_receipts
       set details = app.order_receipt_details(new.id), updated_at = now()
     where order_id = new.id;
  exception when others then
    raise warning '%: receipt not refreshed: %', tg_name, sqlerrm;
  end;
  return null;
end;
$$;
create trigger refresh_order_receipt
  after update of status, customer_name, customer_phone, customer_email, delivery_address, notes on public.orders
  for each row execute function app.refresh_order_receipt();

-- An order's receipt, for printing (orders.read). Orders placed before
-- receipts existed get theirs on first use.
create or replace function public.order_receipt(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_receipt public.order_receipts%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found then
    raise exception 'NOT_FOUND: order does not exist';
  end if;
  if not (app.has_permission(v_order.tenant_id, 'orders.read') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: orders.read required' using errcode = '42501';
  end if;
  insert into public.order_receipts (tenant_id, order_id, receipt_number, details)
  values (v_order.tenant_id, v_order.id, 'R-' || lpad(v_order.order_number::text, 6, '0'), app.order_receipt_details(v_order.id))
  on conflict (order_id) do nothing;
  select * into v_receipt from public.order_receipts where order_id = p_order_id;
  return jsonb_build_object(
    'id', v_receipt.id,
    'order_id', v_receipt.order_id,
    'order_status', v_order.status,
    'receipt_number', v_receipt.receipt_number,
    'token', v_receipt.token,
    'issued_at', v_receipt.issued_at,
    'details', v_receipt.details,
    'auto_printed_at', v_receipt.auto_printed_at,
    'print_count', v_receipt.print_count
  );
end;
$$;
revoke all on function public.order_receipt(uuid) from public, anon;
grant execute on function public.order_receipt(uuid) to authenticated;

-- A receipt was printed. Automatic printing claims the receipt first: only the
-- first console to ask (of every tab and device open) prints it — true only then.
create or replace function public.record_receipt_print(p_order_id uuid, p_auto boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select tenant_id into v_tenant from public.order_receipts where order_id = p_order_id;
  if v_tenant is null then
    return false;
  end if;
  if not (app.has_permission(v_tenant, 'orders.read') or app.is_super_admin()) then
    raise exception 'PERMISSION_ERROR: orders.read required' using errcode = '42501';
  end if;
  if p_auto then
    update public.order_receipts
       set auto_printed_at = now(), print_count = print_count + 1, last_printed_at = now()
     where order_id = p_order_id and auto_printed_at is null;
  else
    update public.order_receipts
       set print_count = print_count + 1, last_printed_at = now()
     where order_id = p_order_id;
  end if;
  return found;
end;
$$;
revoke all on function public.record_receipt_print(uuid, boolean) from public, anon;
grant execute on function public.record_receipt_print(uuid, boolean) to authenticated;
