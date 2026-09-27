-- Phase 4 — Customer Agent. Conversation storage (spec §18, §20). Customers
-- reaching the External Agent (addendum §14) or a future website widget
-- have no Supabase Auth identity at all — there is no "customer" account
-- system yet — so unlike every table so far, there is deliberately **no
-- RLS write policy, no SECURITY DEFINER function, and no anon grant** here.
-- The only way to reach these tables is the service-role client, used
-- exclusively from `src/server/agent-public/actions.ts` (a trusted Next.js
-- Server Action, never the browser), which resolves and validates the
-- tenant and the session token itself before ever touching the database.
-- Staff read access (a future Conversations console page) is the one
-- ordinary RLS policy below.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  -- SHA-256 hex of a random per-conversation token stored in an HttpOnly
  -- cookie — the same "only the hash is ever stored" pattern this product's
  -- sibling project uses for guest carts/bookings. The raw token is never
  -- persisted; presenting it is what proves "this is the same customer".
  session_token_hash text not null unique,
  channel text not null default 'external_agent' check (channel in ('external_agent', 'website_widget')),
  locale text not null default 'en',
  status text not null default 'open' check (status in ('open', 'closed')),
  started_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger set_updated_at before update on public.conversations
  for each row execute function app.set_updated_at();
create index conversations_tenant_idx on public.conversations (tenant_id, last_message_at desc);

alter table public.conversations enable row level security;
alter table public.conversations force row level security;
create policy conversations_select on public.conversations
  for select using (app.has_permission(tenant_id, 'agent.read') or app.is_super_admin());
-- No insert/update/delete policy — see the file header.

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  -- Only set on assistant messages — mirrors agent_interactions.handled_by
  -- so a conversation transcript can show "answered without AI" inline,
  -- without joining back to the cost ledger.
  handled_by text check (handled_by in ('deterministic', 'ai')),
  created_at timestamptz not null default now(),
  constraint conversation_messages_assistant_has_handled_by check (
    role = 'user' or handled_by is not null
  )
);
create index conversation_messages_conversation_idx on public.conversation_messages (conversation_id, created_at);

alter table public.conversation_messages enable row level security;
alter table public.conversation_messages force row level security;
create policy conversation_messages_select on public.conversation_messages
  for select using (app.has_permission(tenant_id, 'agent.read') or app.is_super_admin());
