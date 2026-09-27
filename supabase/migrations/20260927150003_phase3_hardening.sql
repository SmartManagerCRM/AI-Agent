-- Phase 3 — AI Gateway. Same anon-execute cleanup as Phase 1/2's hardening
-- migrations.
revoke execute on function public.record_agent_interaction(
  uuid, text, text, text, text, text, integer, integer, numeric, integer, boolean, boolean, text
) from anon;
