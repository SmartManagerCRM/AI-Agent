-- Phase 6 — Payments hardening. Same anon-execute cleanup every phase's
-- new SECURITY DEFINER functions need (Supabase grants PUBLIC/anon EXECUTE
-- on a newly created function regardless of the CREATE migration's own
-- explicit grants). record_payment_provider_intent, mark_payment_succeeded
-- and mark_payment_failed are also stripped from `authenticated` — unlike
-- create_payment_attempt (a staff console retry is legitimate), these
-- three are reachable only from service-role code that has already
-- verified a provider's webhook signature or just called the provider's
-- own API; no signed-in user session should ever be able to call them.
revoke execute on function public.create_payment_attempt(uuid, text) from anon;
revoke execute on function public.record_payment_provider_intent(uuid, text) from anon, authenticated;
revoke execute on function public.mark_payment_succeeded(uuid, text, jsonb) from anon, authenticated;
revoke execute on function public.mark_payment_failed(uuid, text, jsonb, text) from anon, authenticated;
