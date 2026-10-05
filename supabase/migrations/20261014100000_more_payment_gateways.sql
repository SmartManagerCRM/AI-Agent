-- More payment gateways a business can connect for its customers' orders:
-- Stripe, PayPal, HyperPay and MyFatoorah, next to Moyasar and Tap.
--
-- Same model as Moyasar/Tap (20260928000001_real_payment_providers.sql):
-- each business connects its own merchant account (money goes straight to
-- it), the credentials live in `tenant_payment_config` — readable only with
-- settings.write — and are never sent back to a browser.
--
--   stripe      secret key; webhook signing secret (optional — payments are
--               also confirmed by asking Stripe when the customer returns)
--   paypal      REST client id + secret; sandbox or live
--   hyperpay    access token + entity id (cards); optional mada entity id
--               (HyperPay gives mada its own entity in Saudi Arabia); test or live
--   myfatoorah  API token + the account's country (its API host); test or live

alter table public.tenant_payment_config
  add column stripe_secret_key text,
  add column stripe_webhook_secret text,
  add column paypal_client_id text,
  add column paypal_client_secret text,
  add column paypal_test_mode boolean not null default false,
  add column hyperpay_access_token text,
  add column hyperpay_entity_id text,
  add column hyperpay_mada_entity_id text,
  add column hyperpay_test_mode boolean not null default false,
  add column myfatoorah_api_token text,
  add column myfatoorah_country text not null default 'KWT'
    check (myfatoorah_country in ('KWT', 'SAU', 'ARE', 'QAT', 'BHR', 'OMN', 'JOR', 'EGY')),
  add column myfatoorah_test_mode boolean not null default false;

alter table public.tenant_payment_config drop constraint tenant_payment_config_enabled_methods_check;
alter table public.tenant_payment_config add constraint tenant_payment_config_enabled_methods_check
  check (enabled_methods <@ array['moyasar', 'tap', 'stripe', 'paypal', 'hyperpay', 'myfatoorah', 'cash_on_delivery', 'pay_on_table']);

alter table public.payments drop constraint payments_provider_check;
alter table public.payments add constraint payments_provider_check
  check (provider in ('mock', 'moyasar', 'tap', 'stripe', 'paypal', 'hyperpay', 'myfatoorah', 'cash_on_delivery', 'pay_on_table'));

alter table public.carts drop constraint carts_payment_method_check;
alter table public.carts add constraint carts_payment_method_check
  check (payment_method in ('moyasar', 'tap', 'stripe', 'paypal', 'hyperpay', 'myfatoorah', 'cash_on_delivery', 'pay_on_table'));

-- Super Admin → Integrations: which gateways each business has connected
-- (whether credentials are set — never the credentials themselves).
drop function public.tenant_payment_integration_status();
create function public.tenant_payment_integration_status()
returns table (
  tenant_id uuid,
  moyasar_connected boolean,
  tap_connected boolean,
  stripe_connected boolean,
  paypal_connected boolean,
  hyperpay_connected boolean,
  myfatoorah_connected boolean,
  enabled_methods text[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select tenant_id,
         moyasar_secret_key is not null,
         tap_secret_key is not null,
         stripe_secret_key is not null,
         paypal_client_id is not null and paypal_client_secret is not null,
         hyperpay_access_token is not null and hyperpay_entity_id is not null,
         myfatoorah_api_token is not null,
         enabled_methods
  from public.tenant_payment_config;
$$;
revoke all on function public.tenant_payment_integration_status() from public, anon;
grant execute on function public.tenant_payment_integration_status() to authenticated;
