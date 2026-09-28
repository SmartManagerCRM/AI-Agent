-- Super Admin Master Spec — Announcements. A real, Super-Admin-authored
-- one-way broadcast shown in every tenant console while active — no
-- fabricated "system message", a real row a real Super Admin wrote.
create table public.platform_announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null check (length(message) between 1 and 500),
  severity text not null default 'info' check (severity in ('info', 'warning')),
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index platform_announcements_active_idx on public.platform_announcements (is_active, created_at desc);

alter table public.platform_announcements enable row level security;
alter table public.platform_announcements force row level security;
-- Any signed-in user (every subscriber/staff member across every tenant)
-- can read active announcements — the whole point is platform-wide
-- visibility; inactive/past ones are Super-Admin-only, same "no reason
-- to expose more than needed" posture as everywhere else in this schema.
create policy platform_announcements_select_active on public.platform_announcements
  for select to authenticated using (is_active or app.is_super_admin());
create policy platform_announcements_insert on public.platform_announcements
  for insert with check (app.is_super_admin());
create policy platform_announcements_update on public.platform_announcements
  for update using (app.is_super_admin()) with check (app.is_super_admin());
