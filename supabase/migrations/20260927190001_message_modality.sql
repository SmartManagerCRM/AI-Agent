-- Multimodal-ready communication layer (per instruction, ahead of Phase 6).
-- Text is the only modality actually produced today; the column exists now
-- so a future voice channel is a new value written by a new adapter, never
-- a schema change to this table (or any change at all to the Business
-- Brain, tools, cart, orders, payments, or fulfillment layers below it —
-- none of those read this column, or ever will need to).
alter table public.conversation_messages
  add column modality text not null default 'text' check (modality in ('text', 'voice'));
