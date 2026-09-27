-- Phase 1 — Foundation. Platform configuration, tenancy, roles/permissions,
-- staff membership. Business Brain, plans/subscriptions/trials, conversations
-- and AI usage are later phases (spec §98) — not created here.

-- ── Platform configuration (spec §76) ───────────────────────────────────────
create table public.platform_settings (
  id boolean primary key default true,
  platform_name text not null default 'SmartManager AI Agent',
  logo_path text,
  supported_languages text[] not null default array['en', 'ar', 'fr'],
  supported_currencies text[] not null default array['SAR', 'USD', 'EUR', 'GBP', 'TND', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'TRY'],
  maintenance_mode boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_settings_single_row check (id)
);
create trigger set_updated_at before update on public.platform_settings
  for each row execute function app.set_updated_at();

-- ── Currencies (spec §77) ────────────────────────────────────────────────
create table public.currencies (
  code char(3) primary key,
  exponent smallint not null check (exponent in (0, 2, 3)),
  name jsonb not null default '{}'::jsonb
);

-- ── Business types (spec §47, §78 — data-driven, not a hard-coded enum) ──
create table public.business_types (
  key text primary key,
  name jsonb not null default '{}'::jsonb,
  is_active boolean not null default true
);

-- ── Tenants (spec §21) ───────────────────────────────────────────────────
create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique,
  business_name jsonb not null default '{}'::jsonb,
  business_type_key text not null references public.business_types(key),
  status text not null default 'onboarding' check (status in ('onboarding', 'active', 'suspended', 'closed')),
  default_language text not null default 'en',
  enabled_languages text[] not null default array['en'],
  currency char(3) not null references public.currencies(code),
  timezone text not null default 'UTC',
  country text,
  city text,
  contact_email citext,
  contact_phone text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$')
);
create trigger set_updated_at before update on public.tenants
  for each row execute function app.set_updated_at();

-- ── Tenant AI-agent settings (spec §44 — separate from the system prompt) ──
create table public.tenant_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  agent jsonb not null default jsonb_build_object(
    'active', false,
    'assistant_name', null,
    'greeting', null,
    'tone', 'friendly'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.tenant_settings
  for each row execute function app.set_updated_at();

-- ── Profiles (mirrors auth.users; spec §22) ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  preferred_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.profiles
  for each row execute function app.set_updated_at();

create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, preferred_language)
  values (new.id, new.raw_user_meta_data ->> 'full_name', coalesce(new.raw_user_meta_data ->> 'preferred_language', 'en'))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_auth_user();

-- ── Platform admins (spec §3.3 Super Admin) ─────────────────────────────
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level text not null default 'admin',
  created_at timestamptz not null default now()
);

-- ── Roles / permissions (spec §22) ──────────────────────────────────────
-- `tenant_id = null` marks a system role (business_owner/business_admin/staff);
-- tenants creating custom roles is a later phase.
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  key text not null,
  name jsonb not null default '{}'::jsonb
);
create unique index roles_system_key_uidx on public.roles (key) where tenant_id is null;
create unique index roles_tenant_key_uidx on public.roles (tenant_id, key) where tenant_id is not null;

create table public.permissions (
  key text primary key,
  module text not null,
  description text
);

create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

-- ── Tenant staff membership (spec §22) ───────────────────────────────────
create table public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create trigger set_updated_at before update on public.tenant_members
  for each row execute function app.set_updated_at();

create index tenant_members_user_idx on public.tenant_members (user_id);
create index tenants_business_type_idx on public.tenants (business_type_key);
