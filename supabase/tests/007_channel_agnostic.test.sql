-- pgTAP: multimodal-ready communication layer checks (ahead of Phase 6).
-- Text is the only modality produced today; this only pins the reserved
-- column and its default/check so the boundary documented in
-- src/server/ai/channel.ts stays true at the schema level.
begin;
select plan(3);

select has_column('public', 'conversation_messages', 'modality', 'conversation_messages.modality exists');

select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'conversation_messages' and column_name = 'modality'),
  '''text''::text',
  'modality defaults to text'
);

select throws_ok(
  $$ insert into public.conversation_messages (tenant_id, conversation_id, role, content, modality)
     values (gen_random_uuid(), gen_random_uuid(), 'user', 'x', 'sms') $$,
  '23514',
  null,
  'modality is constrained to text/voice'
);

select * from finish();
rollback;
