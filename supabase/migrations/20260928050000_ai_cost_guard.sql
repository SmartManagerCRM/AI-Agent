-- Super Admin Master Spec, Phase 6 — AI Cost Guard.
--
-- The platform pays for AI usage directly (Gemini/Anthropic API keys are
-- platform-level env vars — see ai_model_configs' own doc comment),
-- while a tenant's subscription is a flat plan price, never metered per
-- token. That makes AI spend a platform cost-control lever, not a
-- tenant-facing budget — same posture as `tenants.status`, which only
-- Super Admin ever sets even though the RLS policy technically permits
-- any settings.write holder to (no dedicated column-level lock, matching
-- this codebase's existing app-layer-gates-the-sensitive-field
-- convention rather than inventing new column-level RLS).
--
-- Both new columns are nullable with no default: null means "no cap",
-- the honest current behavior (unlimited) until a real operator sets a
-- real number — never a fabricated default budget.
alter table public.platform_settings
  add column default_ai_monthly_budget_usd numeric check (default_ai_monthly_budget_usd >= 0);

alter table public.tenant_settings
  add column ai_monthly_budget_usd numeric check (ai_monthly_budget_usd >= 0);
