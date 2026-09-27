-- Phase 9 — Super Admin hardening. Same anon-execute cleanup every
-- phase's new SECURITY DEFINER functions need.
revoke execute on function public.add_platform_admin(citext, text) from anon;
revoke execute on function public.remove_platform_admin(uuid) from anon;
