-- A conversation could only ever have ONE cart (`carts.conversation_id`
-- was unique). Once that cart became an order (status `converted`), the
-- same customer could never order again in that conversation: new items
-- were added to the already-converted cart and checkout refused it ("this
-- cart is no longer active"). The rule is now: at most one ACTIVE cart per
-- conversation; converted/abandoned carts stay as the record of past
-- orders, and the app starts a new cart after each order.
alter table public.carts drop constraint carts_conversation_id_key;
create unique index carts_one_active_per_conversation on public.carts (conversation_id) where status = 'active';
-- Lookups of a conversation's carts (and the FK's cascade) without the old unique index.
create index carts_conversation_idx on public.carts (conversation_id);
