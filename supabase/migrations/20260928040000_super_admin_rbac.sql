-- Super Admin Master Spec, Phase 5 — granular per-permission RBAC UI.
--
-- The real, code-enforced granular permission model already exists
-- (roles/permissions/role_permissions, wired into every tenant-scoped RLS
-- policy through app.has_permission) — what's missing is any UI surface
-- for it at all. Today there is no way for anyone, Super Admin included,
-- to see which of the 19 real permissions each of the 3 system roles
-- (business_owner/business_admin/staff) actually grants, let alone change
-- it. This migration adds the write policy that lets a Super Admin toggle
-- an existing permission on/off for an existing system role.
--
-- Deliberately NOT in scope: creating new roles or new permission keys.
-- `roles`/`permissions` stay seed-only (per the RLS comment they've
-- carried since Phase 1: "tenant custom roles is a later phase") — a
-- permission key with no matching `app.has_permission(tenant_id, '...')`
-- check anywhere in the code would be a toggle that does nothing, exactly
-- the kind of non-functional field this project avoids (see
-- subscription_plans.limits' own history for the same reasoning). Only
-- role_permissions — which of the real, already-checked permissions an
-- existing system role has — becomes writable.
--
-- These are genuinely global, platform-wide policy changes: system roles
-- have tenant_id = null, so toggling e.g. staff.write off for the "Staff"
-- role changes what every business's staff can do, across the whole
-- platform, at once — a Super Admin lever, not a per-tenant one (a
-- tenant's own custom roles remain a later phase, same as the RLS
-- comment already said).
create policy role_permissions_insert on public.role_permissions
  for insert with check (app.is_super_admin());
create policy role_permissions_delete on public.role_permissions
  for delete using (app.is_super_admin());
