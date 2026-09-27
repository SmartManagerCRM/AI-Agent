-- Phase 8 — Staff admin hardening. Same anon-execute cleanup every
-- phase's new SECURITY DEFINER functions need.
revoke execute on function public.create_staff_invite(uuid, citext, text) from anon;
revoke execute on function public.accept_staff_invite(text) from anon;
revoke execute on function public.revoke_staff_invite(uuid) from anon;
revoke execute on function public.update_staff_member_role(uuid, text) from anon;
revoke execute on function public.set_staff_member_status(uuid, text) from anon;
