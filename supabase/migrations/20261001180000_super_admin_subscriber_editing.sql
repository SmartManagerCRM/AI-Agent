-- Super Admin: edit any subscriber — business profile, owner, subscription.
--
-- Only Super Admin may call these (checked here, in the database, not just
-- by the page). Every change is written to the audit log with what it was
-- before. Per-subscriber usage thresholds keep using
-- `set_subscription_usage_overrides`.

create or replace function public.admin_update_business(
  p_tenant_id uuid,
  p_name_locale text,
  p_business_name text,
  p_business_type_key text,
  p_status text,
  p_contact_email text,
  p_contact_phone text,
  p_website_url text,
  p_country text,
  p_city text,
  p_timezone text,
  p_default_language text,
  p_deployment_mode text,
  p_owner_full_name text,
  p_owner_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before public.tenants%rowtype;
  v_owner uuid;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  select * into v_before from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'NOT_FOUND: business does not exist';
  end if;
  if nullif(btrim(p_business_name), '') is null then
    raise exception 'VALIDATION_ERROR: business name is required';
  end if;
  if p_name_locale is null or p_name_locale !~ '^[a-z]{2}$' then
    raise exception 'VALIDATION_ERROR: invalid language for the business name';
  end if;
  if not exists (select 1 from public.business_types where key = p_business_type_key) then
    raise exception 'VALIDATION_ERROR: unknown business type';
  end if;
  if p_status not in ('onboarding', 'active', 'suspended', 'closed') then
    raise exception 'VALIDATION_ERROR: invalid business status';
  end if;
  if p_deployment_mode not in ('website_widget', 'external_agent', 'both') then
    raise exception 'VALIDATION_ERROR: invalid deployment mode';
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone) then
    raise exception 'VALIDATION_ERROR: unknown timezone';
  end if;
  if p_default_language is null or p_default_language !~ '^[a-z]{2}$' then
    raise exception 'VALIDATION_ERROR: invalid default language';
  end if;
  if nullif(btrim(p_contact_email), '') is not null and btrim(p_contact_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'VALIDATION_ERROR: invalid contact email';
  end if;

  update public.tenants set
    business_name = business_name || jsonb_build_object(p_name_locale, btrim(p_business_name)),
    business_type_key = p_business_type_key,
    status = p_status,
    contact_email = nullif(btrim(p_contact_email), '')::extensions.citext,
    contact_phone = nullif(btrim(p_contact_phone), ''),
    website_url = nullif(btrim(p_website_url), ''),
    country = nullif(btrim(p_country), ''),
    city = nullif(btrim(p_city), ''),
    timezone = p_timezone,
    default_language = p_default_language,
    enabled_languages = case when p_default_language = any (enabled_languages) then enabled_languages
                             else enabled_languages || p_default_language end,
    deployment_mode = p_deployment_mode
  where id = p_tenant_id;

  select tm.user_id into v_owner
  from public.tenant_members tm join public.roles r on r.id = tm.role_id
  where tm.tenant_id = p_tenant_id and r.key = 'business_owner' and r.tenant_id is null
  order by tm.created_at
  limit 1;
  if v_owner is not null then
    update public.profiles
      set full_name = nullif(btrim(p_owner_full_name), ''), phone = nullif(btrim(p_owner_phone), '')
      where id = v_owner;
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'admin.business_updated', 'tenant', p_tenant_id,
    jsonb_build_object('before', jsonb_build_object(
      'business_name', v_before.business_name, 'business_type_key', v_before.business_type_key, 'status', v_before.status,
      'contact_email', v_before.contact_email, 'contact_phone', v_before.contact_phone, 'website_url', v_before.website_url,
      'country', v_before.country, 'city', v_before.city, 'timezone', v_before.timezone,
      'default_language', v_before.default_language, 'deployment_mode', v_before.deployment_mode)));
end;
$function$;
revoke all on function public.admin_update_business(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_business(uuid, text, text, text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;

create or replace function public.admin_update_subscription(
  p_tenant_id uuid,
  p_plan_key text,
  p_status text,
  p_trial_ends_at timestamptz,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_before public.subscriptions%rowtype;
begin
  if not app.is_super_admin() then
    raise exception 'PERMISSION_ERROR: super admin required' using errcode = '42501';
  end if;
  select * into v_before from public.subscriptions where tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'NOT_FOUND: this business has no subscription';
  end if;
  if not exists (select 1 from public.subscription_plans where key = p_plan_key) then
    raise exception 'VALIDATION_ERROR: unknown plan';
  end if;
  if p_status not in ('trialing', 'active', 'past_due', 'canceled') then
    raise exception 'VALIDATION_ERROR: invalid subscription status';
  end if;
  if p_trial_ends_at is null then
    raise exception 'VALIDATION_ERROR: trial end date is required';
  end if;
  if p_status = 'active' and (p_current_period_start is null or p_current_period_end is null) then
    raise exception 'VALIDATION_ERROR: an active subscription needs its billing period start and end';
  end if;
  if (p_current_period_start is null) <> (p_current_period_end is null) then
    raise exception 'VALIDATION_ERROR: set both billing period dates, or neither';
  end if;
  if p_current_period_end <= p_current_period_start then
    raise exception 'VALIDATION_ERROR: the billing period must end after it starts';
  end if;

  update public.subscriptions set
    plan_key = p_plan_key,
    status = p_status,
    trial_ends_at = p_trial_ends_at,
    current_period_start = p_current_period_start,
    current_period_end = p_current_period_end,
    canceled_at = case when p_status = 'canceled' then coalesce(canceled_at, now()) end,
    -- A different billing period starts its conversation grace clean.
    conversation_limit_reached_at = case when current_period_start is not distinct from p_current_period_start
                                         then conversation_limit_reached_at end,
    conversation_limit_grace_until = case when current_period_start is not distinct from p_current_period_start
                                          then conversation_limit_grace_until end
  where tenant_id = p_tenant_id;

  -- Re-evaluate limits against the new values right away (grace period, trial limits).
  perform app.usage_snapshot(p_tenant_id, true);

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id, diff)
  values (p_tenant_id, auth.uid(), 'admin.subscription_updated', 'subscription', p_tenant_id,
    jsonb_build_object(
      'before', jsonb_build_object('plan_key', v_before.plan_key, 'status', v_before.status, 'trial_ends_at', v_before.trial_ends_at,
        'current_period_start', v_before.current_period_start, 'current_period_end', v_before.current_period_end),
      'after', jsonb_build_object('plan_key', p_plan_key, 'status', p_status, 'trial_ends_at', p_trial_ends_at,
        'current_period_start', p_current_period_start, 'current_period_end', p_current_period_end)));
end;
$function$;
revoke all on function public.admin_update_subscription(uuid, text, text, timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_update_subscription(uuid, text, text, timestamptz, timestamptz, timestamptz) to authenticated;
