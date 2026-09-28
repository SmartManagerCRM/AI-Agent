-- Supabase grants `EXECUTE` on every new `public` schema function to
-- `anon` by default (a schema-level default privilege, separate from the
-- `PUBLIC` pseudo-role the previous migration already revoked from) —
-- the advisor flagged both impersonation functions as anon-callable.
-- Neither should be: `start_tenant_impersonation` already re-checks
-- `app.is_super_admin()` internally so an anonymous caller can't gain
-- anything from it, but there's no legitimate reason to leave either
-- reachable pre-login at all. Same fix already applied to
-- `my_tenant_memberships` in 20260927130006_phase1_hardening.sql.
revoke execute on function public.start_tenant_impersonation(uuid) from anon;
revoke execute on function public.end_tenant_impersonation() from anon;
