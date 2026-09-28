-- Customer Agent Master Prompt §25 "Dine-in / Table Mode" + §39 "QR
-- Codes". A real table concept per branch, and a third real fulfillment
-- type (dine_in) alongside the existing pickup/delivery — never a fake
-- "table service" that doesn't actually route the order anywhere. Table
-- identity always comes from a real `branch_tables` row the server
-- validates, never trusted as-is from a QR's own query parameters (spec
-- §25/§39: "query parameters are not trusted authorization") — the
-- customer-facing page only uses `?branch=&table=` to look up which real
-- row to attach, exactly like every other public lookup in this schema.
create table public.branch_tables (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete cascade,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index branch_tables_branch_label_uidx on public.branch_tables (branch_id, label);
create index branch_tables_tenant_idx on public.branch_tables (tenant_id);

alter table public.branch_tables enable row level security;
alter table public.branch_tables force row level security;
create policy branch_tables_select on public.branch_tables
  for select using (app.has_permission(tenant_id, 'branches.read'));
create policy branch_tables_insert on public.branch_tables
  for insert with check (app.has_permission(tenant_id, 'branches.write'));
create policy branch_tables_update on public.branch_tables
  for update using (app.has_permission(tenant_id, 'branches.write'))
  with check (app.has_permission(tenant_id, 'branches.write'));
create policy branch_tables_delete on public.branch_tables
  for delete using (app.has_permission(tenant_id, 'branches.write'));

alter table public.carts drop constraint carts_fulfillment_type_check;
alter table public.carts add constraint carts_fulfillment_type_check
  check (fulfillment_type in ('pickup', 'delivery', 'dine_in'));
alter table public.carts add column table_id uuid references public.branch_tables(id) on delete set null;

alter table public.orders drop constraint orders_fulfillment_type_check;
alter table public.orders add constraint orders_fulfillment_type_check
  check (fulfillment_type in ('pickup', 'delivery', 'dine_in'));
alter table public.orders add column table_id uuid references public.branch_tables(id) on delete set null;
