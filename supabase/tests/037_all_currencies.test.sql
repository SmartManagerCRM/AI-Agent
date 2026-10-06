-- pgTAP: the currency list — every Middle East & North Africa currency and the
-- world's other national currencies, without the Israeli shekel; the public
-- site's menu lists them all.
begin;
select plan(7);

select is(
  (select array_agg(c order by c) from unnest(array[
    'AED','BHD','DJF','DZD','EGP','ERN','IQD','IRR','JOD','KMF','KWD','LBP','LYD','MAD','MRU','OMR',
    'QAR','SAR','SDG','SOS','SSP','SYP','TND','TRY','YER']) c
   where not exists (select 1 from public.currencies where code = c)),
  null,
  'every Middle East & North Africa currency is in the list');

select is(
  (select array_agg(c order by c) from unnest(array[
    'USD','EUR','GBP','CHF','JPY','CNY','CAD','AUD','INR','PKR','BRL','MXN','ZAR','NGN','KES','XOF','XAF',
    'RSD','ALL','DOP','JMD','BOB','UYU','MUR','MZN','AOA','RWF','XPF','MNT','KHR']) c
   where not exists (select 1 from public.currencies where code = c)),
  null,
  'and the international ones');

select ok(not exists (select 1 from public.currencies where code = 'ILS'), 'the Israeli shekel is not in the list');
select ok((select count(*) from public.currencies) >= 150, 'about every national currency is there');

select is(
  (select count(*)::int from public.currencies
    where coalesce(name ->> 'en', '') = '' or coalesce(name ->> 'ar', '') = '' or coalesce(name ->> 'fr', '') = ''),
  0,
  'each has its name in English, Arabic and French');

select is(
  (select array_agg(code order by code) from public.currencies
    where code = any(array['XPF','VUV','PYG','RWF','BIF','GNF']) and exponent <> 0),
  null,
  'currencies without minor units have none (ISO 4217)');

select ok(
  (select s.supported_currencies @> (select array_agg(code::text) from public.currencies)
          and not ('ILS' = any(s.supported_currencies))
     from public.platform_settings s),
  'the public site lists every currency, never the shekel');

select * from finish();
rollback;
