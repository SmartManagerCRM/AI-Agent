-- Current Gemini models. `gemini-2.5-flash-lite` and `gemini-2.5-flash`
-- are no longer served to newly created API keys: every call returns
-- 404 "This model … is no longer available to new users" (recorded in
-- agent_interactions for Business Brain vision and the customer Agent).
-- With both defaults failing, every AI reply fell back to "I'm having
-- trouble reaching my AI assistant" and menu images were never read by
-- vision. The router reads this table, so the fix is configuration: the
-- replacements Google names for those models become the defaults, and the
-- 2.5 rows are switched off (not deleted — a Super Admin can turn them
-- back on for an older key that still has access).
--
-- Prices are the published per-1M-token list prices at the time of this
-- change; like the original seed, Super Admin should confirm them at
-- ai.google.dev/pricing before relying on them for budgets.

update public.ai_model_configs
set is_default = false,
    is_active = false,
    notes = 'Not served to newer API keys (404 "no longer available to new users") — replaced by gemini-3.5-flash-lite / gemini-3.8-flash. Re-enable only for a key that still has access.'
where provider = 'gemini' and model in ('gemini-2.5-flash-lite', 'gemini-2.5-flash');

insert into public.ai_model_configs (provider, model, kind, input_price_per_million_usd, output_price_per_million_usd, is_active, is_default, notes)
select 'gemini', 'gemini-3.5-flash-lite', 'fast', 0.30, 2.50, true, true,
  'Replacement for gemini-2.5-flash-lite. List price at setup ($0.30 in / $2.50 out per 1M tokens); verify against ai.google.dev/pricing.'
where not exists (select 1 from public.ai_model_configs where provider = 'gemini' and model = 'gemini-3.5-flash-lite');

insert into public.ai_model_configs (provider, model, kind, input_price_per_million_usd, output_price_per_million_usd, is_active, is_default, notes)
select 'gemini', 'gemini-3.8-flash', 'agent', 0.75, 3.75, true, true,
  'Replacement for gemini-2.5-flash. Introductory list price at setup ($0.75 in / $3.75 out per 1M tokens, through 2026-12-31; $1.50 / $7.50 from 2027-01-01 — update then); verify against ai.google.dev/pricing.'
where not exists (select 1 from public.ai_model_configs where provider = 'gemini' and model = 'gemini-3.8-flash');
