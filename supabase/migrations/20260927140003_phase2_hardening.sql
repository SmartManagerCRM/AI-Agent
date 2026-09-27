-- Phase 2 — Business Brain. Same anon-execute cleanup as Phase 1's
-- `phase1_hardening`: these SECURITY DEFINER functions must be callable only
-- by a signed-in user (they all re-check `brain.write` internally, but the
-- grant itself should not exist for `anon`).
revoke execute on function public.create_brain_entry(uuid, text, text, jsonb, text, uuid) from anon;
revoke execute on function public.update_brain_entry(uuid, jsonb) from anon;
revoke execute on function public.approve_brain_entry(uuid) from anon;
revoke execute on function public.reject_brain_entry(uuid, text) from anon;
revoke execute on function public.set_brain_entry_active(uuid, boolean) from anon;
