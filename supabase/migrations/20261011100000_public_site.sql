-- The public website (ai-agent.smartmanager.me): pricing from Super Admin's
-- plans, sign-up on a chosen plan, and the company's contact details.
--
--   * Plans gain what the pricing page shows: a description, a feature list
--     (one per line), "most popular", whether the plan is shown publicly, and
--     its family — a monthly plan and its annual version share one, so the
--     Monthly / Annual switch finds both. Description and features are texts
--     per language, like the name (translated automatically when missing).
--   * Annual plans: 10 months' price for a year. A plan's conversation limit
--     and AI cost cap apply per billing period, so the annual version gets 12
--     months' worth — the same allowance per month as the monthly plan.
--   * Visitors (anon) read plans and contact details only through two
--     functions returning what the website shows — never the tables.
--   * create_business can start the trial on the plan chosen on the website
--     (its own trial length, as before), and record the owner's name, the
--     business's country and phone from the sign-up form.

-- ── Plans ───────────────────────────────────────────────────────────────
alter table public.subscription_plans
  add column description jsonb not null default '{}'::jsonb,
  add column features jsonb not null default '{}'::jsonb,
  add column is_popular boolean not null default false,
  add column is_public boolean not null default true,
  add column plan_family text check (plan_family is null or plan_family ~ '^[a-z][a-z0-9_-]*$');

update public.subscription_plans set
  description = '{"en": "Perfect for small businesses", "ar": "مثالية للأعمال الصغيرة", "fr": "Idéale pour les petites entreprises"}'::jsonb,
  features = jsonb_build_object(
    'en', E'AI Agent 24/7\nOnline ordering & booking\nProducts / services management\nBasic analytics\nWebsite widget (optional)\nQR ordering',
    'ar', E'وكيل ذكاء اصطناعي على مدار الساعة\nالطلب والحجز عبر الإنترنت\nإدارة المنتجات / الخدمات\nتحليلات أساسية\nأداة الموقع الإلكتروني (اختيارية)\nالطلب عبر رمز QR',
    'fr', E'Agent IA 24h/24, 7j/7\nCommandes et réservations en ligne\nGestion des produits / services\nStatistiques de base\nWidget pour site web (optionnel)\nCommande par QR code')
  where key = 'starter';
update public.subscription_plans set
  description = '{"en": "Great for growing businesses", "ar": "رائعة للأعمال المتنامية", "fr": "Parfaite pour les entreprises en croissance"}'::jsonb,
  features = jsonb_build_object(
    'en', E'AI Agent 24/7\nOnline ordering & booking\nProducts / services management\nAdvanced analytics\nMulti-branch support\nWebsite widget (optional)\nQR ordering\nPriority support',
    'ar', E'وكيل ذكاء اصطناعي على مدار الساعة\nالطلب والحجز عبر الإنترنت\nإدارة المنتجات / الخدمات\nتحليلات متقدمة\nدعم الفروع المتعددة\nأداة الموقع الإلكتروني (اختيارية)\nالطلب عبر رمز QR\nدعم ذو أولوية',
    'fr', E'Agent IA 24h/24, 7j/7\nCommandes et réservations en ligne\nGestion des produits / services\nStatistiques avancées\nGestion multi-établissements\nWidget pour site web (optionnel)\nCommande par QR code\nSupport prioritaire'),
  is_popular = true
  where key = 'growth';
update public.subscription_plans set
  description = '{"en": "For high-volume businesses", "ar": "للأعمال ذات الحجم الكبير", "fr": "Pour les entreprises à fort volume"}'::jsonb,
  features = jsonb_build_object(
    'en', E'AI Agent 24/7\nOnline ordering & booking\nProducts / services management\nAdvanced analytics & insights\nMulti-branch support\nWebsite widget (optional)\nQR ordering\nPriority support\nDedicated onboarding & support',
    'ar', E'وكيل ذكاء اصطناعي على مدار الساعة\nالطلب والحجز عبر الإنترنت\nإدارة المنتجات / الخدمات\nتحليلات ورؤى متقدمة\nدعم الفروع المتعددة\nأداة الموقع الإلكتروني (اختيارية)\nالطلب عبر رمز QR\nدعم ذو أولوية\nإعداد ودعم مخصصان',
    'fr', E'Agent IA 24h/24, 7j/7\nCommandes et réservations en ligne\nGestion des produits / services\nStatistiques et analyses avancées\nGestion multi-établissements\nWidget pour site web (optionnel)\nCommande par QR code\nSupport prioritaire\nAccompagnement et support dédiés')
  where key = 'pro';

-- Annual versions of the monthly plans: a year for the price of 10 months.
insert into public.subscription_plans
  (key, name, description, features, price_minor, currency, billing_interval, trial_days, limits, conversation_limit,
   grace_period_hours, is_default, is_active, is_popular, is_public, plan_family, sort_order)
select p.key || '_annual', p.name, p.description, p.features, p.price_minor * 10, p.currency, 'year', p.trial_days, p.limits,
       p.conversation_limit * 12, p.grace_period_hours, false, p.is_active, p.is_popular, p.is_public, p.key, p.sort_order
  from public.subscription_plans p
 where p.key in ('starter', 'growth', 'pro') and p.billing_interval = 'month'
on conflict (key) do nothing;
update public.subscription_plans set plan_family = key where key in ('starter', 'growth', 'pro') and plan_family is null;

insert into public.ai_cost_limits (plan_key, limit_usd)
select p.key || '_annual', l.limit_usd * 12
  from public.subscription_plans p
  join public.ai_cost_limits l on l.plan_key = p.key
 where p.key in ('starter', 'growth', 'pro')
   and exists (select 1 from public.subscription_plans a where a.key = p.key || '_annual')
on conflict (plan_key) do nothing;

-- Plans the website shows (active and public), with what a visitor needs — no limits, costs or internal flags.
create or replace function public.public_subscription_plans()
returns table(
  key text, family text, name jsonb, description jsonb, features jsonb,
  price_minor bigint, currency text, exponent integer, billing_interval text,
  trial_days integer, conversation_limit integer, is_popular boolean, sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.key, coalesce(p.plan_family, p.key), p.name, p.description, p.features,
         p.price_minor, p.currency::text, coalesce(cu.exponent, 2)::integer, p.billing_interval,
         p.trial_days, p.conversation_limit, p.is_popular, p.sort_order
    from public.subscription_plans p
    left join public.currencies cu on cu.code = p.currency
   where p.is_active and p.is_public
   order by p.sort_order, p.billing_interval, p.key;
$$;
revoke all on function public.public_subscription_plans() from public;
grant execute on function public.public_subscription_plans() to anon, authenticated;

-- ── The company's contact details (footer, Contact and legal pages) ─────
alter table public.platform_settings
  add column company_name text,
  add column company_country text,
  add column support_email text,
  add column contact_email text,
  add column contact_phone text,
  -- {"facebook": "https://…", "instagram": …} — shown only when set.
  add column social_links jsonb not null default '{}'::jsonb;

update public.platform_settings set
  company_name = 'Millennium Leaders',
  company_country = 'Tunisia',
  support_email = 'support@smartmanager.me',
  contact_email = 'contact@millenniumtco.com',
  contact_phone = '+216 27 67 97 97'
where id;

grant select (company_name, company_country, support_email, contact_email, contact_phone, social_links)
  on public.platform_settings to authenticated;
grant update (company_name, company_country, support_email, contact_email, contact_phone, social_links)
  on public.platform_settings to authenticated;

create or replace function public.public_site_info()
returns table(
  platform_name text, company_name text, company_country text, support_email text,
  contact_email text, contact_phone text, social_links jsonb, supported_currencies text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.platform_name, s.company_name, s.company_country, s.support_email, s.contact_email, s.contact_phone, s.social_links,
         s.supported_currencies
    from public.platform_settings s
   where s.id;
$$;
revoke all on function public.public_site_info() from public;
grant execute on function public.public_site_info() to anon, authenticated;

-- ── create_business: the plan chosen on the website ─────────────────────
drop function public.create_business(jsonb, text, text, text, char(3));
create function public.create_business(
  p_business_name jsonb,
  p_business_type_key text,
  p_slug text,
  p_default_language text,
  p_currency char(3),
  p_plan_key text default null,
  p_country text default null,
  p_contact_phone text default null,
  p_owner_name text default null
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
  v_plan public.subscription_plans%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_ERROR: sign in required' using errcode = '28000';
  end if;

  select id into v_owner_role_id from public.roles where tenant_id is null and key = 'business_owner';
  if v_owner_role_id is null then
    raise exception 'CONFIG_ERROR: system role business_owner is not seeded';
  end if;

  if p_plan_key is not null then
    -- Only a plan the website offers (active and public).
    select * into v_plan from public.subscription_plans where key = p_plan_key and is_active and is_public;
    if not found then
      raise exception 'VALIDATION_ERROR: that plan isn''t available' using errcode = '22023';
    end if;
  else
    select * into v_plan from public.subscription_plans where is_default and is_active limit 1;
    if not found then
      raise exception 'CONFIG_ERROR: no default subscription plan is seeded';
    end if;
  end if;

  insert into public.tenants (slug, business_name, business_type_key, default_language, enabled_languages, currency, status,
                              country, contact_phone)
  values (lower(p_slug), p_business_name, p_business_type_key, p_default_language, array[p_default_language], p_currency, 'active',
          nullif(btrim(left(p_country, 80)), ''), nullif(btrim(left(p_contact_phone, 40)), ''))
  returning id into v_tenant_id;

  insert into public.tenant_settings (tenant_id) values (v_tenant_id);
  insert into public.tenant_payment_config (tenant_id) values (v_tenant_id);
  insert into public.tenant_counters (tenant_id, next_order_number) values (v_tenant_id, 1000);

  insert into public.subscriptions (tenant_id, plan_key, status, trial_ends_at)
  values (v_tenant_id, v_plan.key, 'trialing', now() + make_interval(days => v_plan.trial_days));

  insert into public.tenant_members (tenant_id, user_id, role_id, status)
  values (v_tenant_id, v_user, v_owner_role_id, 'active');

  if nullif(btrim(p_owner_name), '') is not null then
    update public.profiles set full_name = left(btrim(p_owner_name), 120)
     where id = v_user and coalesce(btrim(full_name), '') = '';
  end if;

  insert into public.audit_logs (tenant_id, actor_id, action, entity, entity_id)
  values (v_tenant_id, v_user, 'tenant.created', 'tenant', v_tenant_id);

  return v_tenant_id;
end;
$$;
revoke all on function public.create_business(jsonb, text, text, text, char(3), text, text, text, text) from public, anon;
grant execute on function public.create_business(jsonb, text, text, text, char(3), text, text, text, text) to authenticated;

-- ── Automatic translation: a plan's description and features too ────────
drop trigger queue_translation on public.subscription_plans;
create trigger queue_translation after insert or update on public.subscription_plans
  for each row execute function app.queue_translation('key', '', 'name', 'description', 'features');

create or replace function app.translatable_column(p_table text, p_field text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_table in ('products', 'bookable_services', 'membership_plans') and p_field in ('name', 'description') then 'id'
    when p_table = 'categories' and p_field = 'name' then 'id'
    when p_table = 'subscription_plans' and p_field in ('name', 'description', 'features') then 'key'
    when p_table = 'business_types' and p_field = 'name' then 'key'
    when p_table = 'platform_announcements' and p_field = 'message_translations' then 'id'
  end;
$$;
