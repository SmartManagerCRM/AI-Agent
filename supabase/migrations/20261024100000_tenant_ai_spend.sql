-- The month's AI spend of one business, summed in the database.
--
-- The AI budget check (src/server/ai/cost-guard.ts) runs before every AI
-- reply. It used to download that month's interactions and add them up — but
-- the data API returns a bounded number of rows per request (1000 by default),
-- so a busy business's total would silently stop growing and its budget never
-- stop it. Same sum, same rule: every interaction's estimated cost since the
-- given time. Service role only (the Agent's gateway).
create or replace function public.tenant_ai_spend(p_tenant_id uuid, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(i.estimated_cost_usd), 0)
    from public.agent_interactions i
   where i.tenant_id = p_tenant_id and i.created_at >= p_since;
$$;
revoke all on function public.tenant_ai_spend(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.tenant_ai_spend(uuid, timestamptz) to service_role;
