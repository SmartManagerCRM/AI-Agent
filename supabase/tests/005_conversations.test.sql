-- pgTAP: Phase 4 structural checks (spec §18, §20; addendum §14).
begin;
select plan(5);

select has_table('public', 'conversations', 'conversations table exists');
select has_table('public', 'conversation_messages', 'conversation_messages table exists');

select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.conversations'::regclass),
  'RLS is enabled and forced on conversations'
);
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.conversation_messages'::regclass),
  'RLS is enabled and forced on conversation_messages'
);

-- No write policy exists on either table at all — every write is the
-- service-role client from src/server/agent-public/actions.ts, which
-- bypasses RLS entirely; there is deliberately nothing for a signed-in
-- user, anon, or any RPC to write through.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename in ('conversations', 'conversation_messages')
     and cmd in ('insert', 'update', 'delete')),
  0,
  'neither conversations nor conversation_messages has a direct write policy'
);

select * from finish();
rollback;
