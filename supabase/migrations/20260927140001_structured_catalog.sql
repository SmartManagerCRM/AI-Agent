-- Phase 2 — Business Brain. Structured, authoritative business data (spec §8:
-- "structured authoritative data always wins over inferred information").
-- Owner-managed directly (create/edit/archive); never written by the crawler
-- or by AI inference — see `business_brain.sql` for the reviewed-knowledge
-- side of the Business Brain.

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name jsonb not null default '{}'::jsonb,
  address jsonb not null default '{}'::jsonb,
  phone text,
  -- One entry per weekday: { "mon": [{"open":"09:00","close":"22:00"}], "tue": [...], ... "sun": [] }.
  -- An empty array means closed that day; the key is simply absent for "not yet configured".
  opening_hours jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.branches
  for each row execute function app.set_updated_at();
create unique index branches_single_default_uidx on public.branches (tenant_id) where is_default;
create index branches_tenant_idx on public.branches (tenant_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.categories
  for each row execute function app.set_updated_at();
create index categories_tenant_idx on public.categories (tenant_id, position);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name jsonb not null default '{}'::jsonb,
  description jsonb not null default '{}'::jsonb,
  -- Minor currency units (spec's own money convention — see ARCHITECTURE_ASSESSMENT.md).
  -- The agent (Phase 4+) only ever reads this column; it never states or
  -- computes a price from memory (spec §2, §12, §62).
  price_minor bigint not null check (price_minor >= 0),
  status text not null default 'draft' check (status in ('draft', 'active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.products
  for each row execute function app.set_updated_at();
create index products_tenant_idx on public.products (tenant_id, status);
create index products_category_idx on public.products (category_id);

-- ── Composite (tenant_id, id) uniqueness so a future child table (e.g. an
--    order line item) can carry a composite FK and never link cross-tenant.
alter table public.branches add constraint branches_tenant_id_uidx unique (tenant_id, id);
alter table public.categories add constraint categories_tenant_id_uidx unique (tenant_id, id);
alter table public.products add constraint products_tenant_id_uidx unique (tenant_id, id);

-- ── Permissions (new module — extends the Phase 1 permission table) ─────
insert into public.permissions (key, module, description) values
  ('branches.read', 'branches', 'View branches'),
  ('branches.write', 'branches', 'Create/edit branches'),
  ('catalog.read', 'catalog', 'View categories and products'),
  ('catalog.write', 'catalog', 'Create/edit categories and products');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null
  and r.key in ('business_owner', 'business_admin')
  and p.key in ('branches.read', 'branches.write', 'catalog.read', 'catalog.write');

insert into public.role_permissions (role_id, permission_key)
select r.id, p.key
from public.roles r
cross join public.permissions p
where r.tenant_id is null and r.key = 'staff'
  and p.key in ('branches.read', 'catalog.read');

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table public.branches enable row level security;
alter table public.branches force row level security;
create policy branches_select on public.branches
  for select using (app.has_permission(tenant_id, 'branches.read'));
create policy branches_insert on public.branches
  for insert with check (app.has_permission(tenant_id, 'branches.write'));
create policy branches_update on public.branches
  for update using (app.has_permission(tenant_id, 'branches.write'))
  with check (app.has_permission(tenant_id, 'branches.write'));
create policy branches_delete on public.branches
  for delete using (app.has_permission(tenant_id, 'branches.write'));

alter table public.categories enable row level security;
alter table public.categories force row level security;
create policy categories_select on public.categories
  for select using (app.has_permission(tenant_id, 'catalog.read'));
create policy categories_insert on public.categories
  for insert with check (app.has_permission(tenant_id, 'catalog.write'));
create policy categories_update on public.categories
  for update using (app.has_permission(tenant_id, 'catalog.write'))
  with check (app.has_permission(tenant_id, 'catalog.write'));
create policy categories_delete on public.categories
  for delete using (app.has_permission(tenant_id, 'catalog.write'));

alter table public.products enable row level security;
alter table public.products force row level security;
create policy products_select on public.products
  for select using (app.has_permission(tenant_id, 'catalog.read'));
create policy products_insert on public.products
  for insert with check (app.has_permission(tenant_id, 'catalog.write'));
create policy products_update on public.products
  for update using (app.has_permission(tenant_id, 'catalog.write'))
  with check (app.has_permission(tenant_id, 'catalog.write'));
create policy products_delete on public.products
  for delete using (app.has_permission(tenant_id, 'catalog.write'));
