-- The console's bell counts conversations with new activity since this
-- person last opened Conversations — once they look, the number goes away
-- (on every device they use). One row per person per business.
create table public.inbox_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

alter table public.inbox_reads enable row level security;
alter table public.inbox_reads force row level security;
-- Each member reads and moves only their own marker, for a business they belong to.
create policy inbox_reads_own on public.inbox_reads
  for all to authenticated
  using (user_id = auth.uid() and app.is_tenant_member(tenant_id))
  with check (user_id = auth.uid() and app.is_tenant_member(tenant_id));
revoke all on public.inbox_reads from anon;
grant select, insert, update on public.inbox_reads to authenticated;
