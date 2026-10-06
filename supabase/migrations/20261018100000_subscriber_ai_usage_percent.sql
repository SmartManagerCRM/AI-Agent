-- The subscriber's dashboard shows how much of the plan's AI allowance this
-- billing period has used — as a share only. `tenant_usage_summary` adds
-- `ai_usage_percent`: the AI cost used against the cap, a whole percent
-- (rounded down, at most 100), or null when there is no cap. The amounts —
-- cost used, reserved and the cap itself — are still removed and never
-- reach a subscriber. Nothing else changes.

create or replace function public.tenant_usage_summary(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if not app.has_permission(p_tenant_id, 'business.read') then
    raise exception 'PERMISSION_ERROR: business access required' using errcode = '42501';
  end if;
  v := app.usage_snapshot(p_tenant_id, true);
  if v is null then
    return null;
  end if;
  return (v - 'ai_cost_limit' - 'ai_cost_used' - 'ai_cost_reserved' - 'ai_calls' - 'ai_cost_percent' - 'ai_state'
            - 'usage_state' - 'conversation_limit_default' - 'conversation_limit_override' - 'trial_end_reason'
            - 'ai_block_reason' - 'ai_response_limit' - 'ai_responses_used' - 'ai_response_percent')
         || jsonb_build_object(
              'ai_limited', v ->> 'ai_state' = 'blocked',
              'trial_end_reason', case v ->> 'trial_end_reason' when 'ai_cost_limit' then 'usage_limit' else v ->> 'trial_end_reason' end,
              'ai_response_percent', case when v ->> 'ai_response_percent' is not null
                then least(100, floor((v ->> 'ai_response_percent')::numeric))::int end,
              -- A share of the AI allowance, never an amount.
              'ai_usage_percent', case when v ->> 'ai_cost_percent' is not null
                then greatest(0, least(100, floor((v ->> 'ai_cost_percent')::numeric)))::int end
            );
end;
$$;
revoke all on function public.tenant_usage_summary(uuid) from public, anon;
grant execute on function public.tenant_usage_summary(uuid) to authenticated;
