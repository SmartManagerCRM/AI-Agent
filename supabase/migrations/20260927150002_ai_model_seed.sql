-- Phase 3 — AI Gateway. Seed model configuration. Gemini is the primary,
-- paid-tier provider (the user's own instruction: a paid Gemini API key is
-- added as an environment variable at deploy time, not the free tier) —
-- both Gemini rows are marked `is_default`. Anthropic is seeded active but
-- not default: the second `AIProvider` implementation the abstraction
-- exists for, available as the router's fallback if a Gemini call fails
-- (spec §68) or a platform operator prefers it later, with no code change
-- either way. All figures are current published list prices, not free-tier
-- numbers — Super Admin (Phase 9 UI; the table itself is already editable)
-- must still confirm them before relying on this for real budget alerts,
-- per spec §6 ("do not assume permanent model names, prices, quotas").
insert into public.ai_model_configs (provider, model, kind, input_price_per_million_usd, output_price_per_million_usd, is_default, notes) values
  ('gemini', 'gemini-2.5-flash-lite', 'fast', 0.10, 0.40, true, 'Paid-tier list price as of setup; verify against ai.google.dev/pricing before relying on for budgeting.'),
  ('gemini', 'gemini-2.5-flash', 'agent', 0.30, 2.50, true, 'Paid-tier list price as of setup; verify against ai.google.dev/pricing before relying on for budgeting.'),
  ('anthropic', 'claude-haiku-4-5', 'fast', 1.00, 5.00, false, 'Fallback provider, inactive by default use (not is_default) — enable by setting ANTHROPIC_API_KEY and flipping is_default if Gemini should not be primary.'),
  ('anthropic', 'claude-sonnet-5', 'agent', 2.00, 10.00, false, 'Fallback provider, inactive by default use (not is_default) — enable by setting ANTHROPIC_API_KEY and flipping is_default if Gemini should not be primary.');
