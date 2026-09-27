-- Phase 7 — Subscriptions hardening. Same anon-execute cleanup every
-- phase's new SECURITY DEFINER functions need. record_subscription_payment_provider_intent,
-- mark_subscription_payment_succeeded and mark_subscription_payment_failed
-- are also stripped from `authenticated` — service-role (the webhook path)
-- only, no signed-in session should ever call them directly.
revoke execute on function public.create_subscription_payment_attempt(uuid, text, text) from anon;
revoke execute on function public.record_subscription_payment_provider_intent(uuid, text) from anon, authenticated;
revoke execute on function public.mark_subscription_payment_succeeded(uuid, text, jsonb) from anon, authenticated;
revoke execute on function public.mark_subscription_payment_failed(uuid, text, jsonb, text) from anon, authenticated;
