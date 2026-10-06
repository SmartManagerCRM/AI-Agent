-- Every Middle East & North Africa currency and the world's other national
-- currencies in the currency menus — except the Israeli shekel, which is
-- taken out of the list. Names in English, Arabic and French (CLDR); minor
-- units per ISO 4217. The public site's currency menu lists them all.

insert into public.currencies (code, exponent, name) values
  ('ERN', 2, '{"en": "Eritrean Nakfa", "ar": "ناكفا أريتري", "fr": "Nafka érythréen"}'),
  ('SSP', 2, '{"en": "South Sudanese Pound", "ar": "جنيه جنوب السودان", "fr": "Livre sud-soudanaise"}'),
  ('ALL', 2, '{"en": "Albanian Lek", "ar": "ليك ألباني", "fr": "Lek albanais"}'),
  ('BAM', 2, '{"en": "Bosnia-Herzegovina Convertible Mark", "ar": "مارك البوسنة والهرسك قابل للتحويل", "fr": "Mark convertible bosniaque"}'),
  ('BYN', 2, '{"en": "Belarusian Ruble", "ar": "روبل بيلاروسي", "fr": "Rouble biélorusse"}'),
  ('MDL', 2, '{"en": "Moldovan Leu", "ar": "ليو مولدوفي", "fr": "Leu moldave"}'),
  ('MKD', 2, '{"en": "Macedonian Denar", "ar": "دينار مقدوني", "fr": "Denar macédonien"}'),
  ('RSD', 2, '{"en": "Serbian Dinar", "ar": "دينار صربي", "fr": "Dinar serbe"}'),
  ('KGS', 2, '{"en": "Kyrgyz Som", "ar": "سوم قيرغستاني", "fr": "Som kirghize"}'),
  ('TJS', 2, '{"en": "Tajikistani Somoni", "ar": "سوموني طاجيكستاني", "fr": "Somoni tadjik"}'),
  ('TMT', 2, '{"en": "Turkmenistani Manat", "ar": "مانات تركمانستان", "fr": "Nouveau manat turkmène"}'),
  ('MNT', 2, '{"en": "Mongolian Tugrik", "ar": "توغروغ منغولي", "fr": "Tugrik mongol"}'),
  ('MMK', 2, '{"en": "Myanmar Kyat", "ar": "كيات ميانمار", "fr": "Kyat myanmarais"}'),
  ('KHR', 2, '{"en": "Cambodian Riel", "ar": "رييال كمبودي", "fr": "Riel cambodgien"}'),
  ('LAK', 2, '{"en": "Laotian Kip", "ar": "كيب لاوسي", "fr": "Kip laotien"}'),
  ('BND', 2, '{"en": "Brunei Dollar", "ar": "دولار بروناي", "fr": "Dollar brunéien"}'),
  ('MOP', 2, '{"en": "Macanese Pataca", "ar": "باتاكا ماكاوي", "fr": "Pataca macanaise"}'),
  ('MVR', 2, '{"en": "Maldivian Rufiyaa", "ar": "روفيه جزر المالديف", "fr": "Rufiyaa maldivienne"}'),
  ('BTN', 2, '{"en": "Bhutanese Ngultrum", "ar": "نولتوم بوتاني", "fr": "Ngultrum bouthanais"}'),
  ('FJD', 2, '{"en": "Fijian Dollar", "ar": "دولار فيجي", "fr": "Dollar fidjien"}'),
  ('PGK', 2, '{"en": "Papua New Guinean Kina", "ar": "كينا بابوا غينيا الجديدة", "fr": "Kina papouan-néo-guinéen"}'),
  ('WST', 2, '{"en": "Samoan Tala", "ar": "تالا ساموا", "fr": "Tala samoan"}'),
  ('TOP', 2, '{"en": "Tongan Paʻanga", "ar": "بانغا تونغا", "fr": "Pa’anga tongan"}'),
  ('VUV', 0, '{"en": "Vanuatu Vatu", "ar": "فاتو فانواتو", "fr": "Vatu vanuatuan"}'),
  ('SBD', 2, '{"en": "Solomon Islands Dollar", "ar": "دولار جزر سليمان", "fr": "Dollar des îles Salomon"}'),
  ('XPF', 0, '{"en": "CFP Franc", "ar": "فرنك سي إف بي", "fr": "Franc CFP"}'),
  ('JMD', 2, '{"en": "Jamaican Dollar", "ar": "دولار جامايكي", "fr": "Dollar jamaïcain"}'),
  ('TTD', 2, '{"en": "Trinidad & Tobago Dollar", "ar": "دولار ترينداد وتوباغو", "fr": "Dollar de Trinité-et-Tobago"}'),
  ('BBD', 2, '{"en": "Barbadian Dollar", "ar": "دولار بربادوسي", "fr": "Dollar barbadien"}'),
  ('BSD', 2, '{"en": "Bahamian Dollar", "ar": "دولار باهامي", "fr": "Dollar bahaméen"}'),
  ('BZD', 2, '{"en": "Belize Dollar", "ar": "دولار بليزي", "fr": "Dollar bélizéen"}'),
  ('BMD', 2, '{"en": "Bermudan Dollar", "ar": "دولار برمودي", "fr": "Dollar bermudien"}'),
  ('KYD', 2, '{"en": "Cayman Islands Dollar", "ar": "دولار جزر كيمن", "fr": "Dollar des îles Caïmans"}'),
  ('XCD', 2, '{"en": "East Caribbean Dollar", "ar": "دولار شرق الكاريبي", "fr": "Dollar des Caraïbes orientales"}'),
  ('DOP', 2, '{"en": "Dominican Peso", "ar": "بيزو الدومنيكان", "fr": "Peso dominicain"}'),
  ('GTQ', 2, '{"en": "Guatemalan Quetzal", "ar": "كوتزال غواتيمالا", "fr": "Quetzal guatémaltèque"}'),
  ('HNL', 2, '{"en": "Honduran Lempira", "ar": "ليمبيرا هنداروس", "fr": "Lempira hondurien"}'),
  ('NIO', 2, '{"en": "Nicaraguan Córdoba", "ar": "قرطبة نيكاراغوا", "fr": "Córdoba oro nicaraguayen"}'),
  ('CRC', 2, '{"en": "Costa Rican Colón", "ar": "كولن كوستاريكي", "fr": "Colón costaricain"}'),
  ('PAB', 2, '{"en": "Panamanian Balboa", "ar": "بالبوا بنمي", "fr": "Balboa panaméen"}'),
  ('CUP', 2, '{"en": "Cuban Peso", "ar": "بيزو كوبي", "fr": "Peso cubain"}'),
  ('HTG', 2, '{"en": "Haitian Gourde", "ar": "جوردى هايتي", "fr": "Gourde haïtienne"}'),
  ('BOB', 2, '{"en": "Bolivian Boliviano", "ar": "بوليفيانو بوليفي", "fr": "Boliviano bolivien"}'),
  ('PYG', 0, '{"en": "Paraguayan Guarani", "ar": "غواراني باراغواي", "fr": "Guaraní paraguayen"}'),
  ('UYU', 2, '{"en": "Uruguayan Peso", "ar": "بيزو اوروغواي", "fr": "Peso uruguayen"}'),
  ('VES', 2, '{"en": "Venezuelan Bolívar", "ar": "بوليفار فنزويلي", "fr": "Bolivar vénézuélien"}'),
  ('GYD', 2, '{"en": "Guyanaese Dollar", "ar": "دولار غيانا", "fr": "Dollar du Guyana"}'),
  ('SRD', 2, '{"en": "Surinamese Dollar", "ar": "دولار سورينامي", "fr": "Dollar surinamais"}'),
  ('AWG', 2, '{"en": "Aruban Florin", "ar": "فلورن أروبي", "fr": "Florin arubais"}'),
  ('XCG', 2, '{"en": "Caribbean Guilder", "ar": "غيلدر كاريبي", "fr": "Florin caribéen"}'),
  ('MUR', 2, '{"en": "Mauritian Rupee", "ar": "روبية موريشيوسية", "fr": "Roupie mauricienne"}'),
  ('SCR', 2, '{"en": "Seychellois Rupee", "ar": "روبية سيشيلية", "fr": "Roupie des Seychelles"}'),
  ('MGA', 2, '{"en": "Malagasy Ariary", "ar": "أرياري مدغشقر", "fr": "Ariary malgache"}'),
  ('MZN', 2, '{"en": "Mozambican Metical", "ar": "متكال موزمبيقي", "fr": "Metical mozambicain"}'),
  ('ZMW', 2, '{"en": "Zambian Kwacha", "ar": "كواشا زامبي", "fr": "Kwacha zambien"}'),
  ('MWK', 2, '{"en": "Malawian Kwacha", "ar": "كواشا مالاوي", "fr": "Kwacha malawite"}'),
  ('BWP', 2, '{"en": "Botswanan Pula", "ar": "بولا بتسواني", "fr": "Pula botswanais"}'),
  ('NAD', 2, '{"en": "Namibian Dollar", "ar": "دولار ناميبي", "fr": "Dollar namibien"}'),
  ('SZL', 2, '{"en": "Swazi Lilangeni", "ar": "ليلانجيني سوازيلندي", "fr": "Lilangeni swazi"}'),
  ('LSL', 2, '{"en": "Lesotho Loti", "ar": "لوتي ليسوتو", "fr": "Loti lesothan"}'),
  ('AOA', 2, '{"en": "Angolan Kwanza", "ar": "كوانزا أنغولي", "fr": "Kwanza angolais"}'),
  ('CDF', 2, '{"en": "Congolese Franc", "ar": "فرنك كونغولي", "fr": "Franc congolais"}'),
  ('RWF', 0, '{"en": "Rwandan Franc", "ar": "فرنك رواندي", "fr": "Franc rwandais"}'),
  ('BIF', 0, '{"en": "Burundian Franc", "ar": "فرنك بروندي", "fr": "Franc burundais"}'),
  ('GMD', 2, '{"en": "Gambian Dalasi", "ar": "دلاسي غامبي", "fr": "Dalasi gambien"}'),
  ('GNF', 0, '{"en": "Guinean Franc", "ar": "فرنك غينيا", "fr": "Franc guinéen"}'),
  ('SLE', 2, '{"en": "Sierra Leonean Leone", "ar": "ليون سيراليوني", "fr": "Leone sierra-léonais"}'),
  ('LRD', 2, '{"en": "Liberian Dollar", "ar": "دولار ليبيري", "fr": "Dollar libérien"}'),
  ('CVE', 2, '{"en": "Cape Verdean Escudo", "ar": "اسكودو الرأس الأخضر", "fr": "Escudo capverdien"}'),
  ('STN', 2, '{"en": "São Tomé & Príncipe Dobra", "ar": "دوبرا ساو تومي وبرينسيبي", "fr": "Dobra santoméen"}'),
  ('ZWG', 2, '{"en": "Zimbabwean Gold", "ar": "ذهب زيمبابوي", "fr": "Or du Zimbabwe"}'),
  ('FKP', 2, '{"en": "Falkland Islands Pound", "ar": "جنيه جزر فوكلاند", "fr": "Livre des îles Malouines"}'),
  ('GIP', 2, '{"en": "Gibraltar Pound", "ar": "جنيه جبل طارق", "fr": "Livre de Gibraltar"}'),
  ('SHP', 2, '{"en": "St. Helena Pound", "ar": "جنيه سانت هيلين", "fr": "Livre de Sainte-Hélène"}')
on conflict (code) do nothing;

-- The shekel leaves the list. Only possible while nothing uses it (no
-- business, plan, order or payment in it) — otherwise stop and say so.
do $$
declare
  v_fk record;
  v_used boolean;
begin
  for v_fk in
    select c.conrelid::regclass as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.currencies'::regclass
  loop
    execute format('select exists (select 1 from %s where %I = %L)', v_fk.tbl, v_fk.col, 'ILS') into v_used;
    if v_used then
      raise exception 'ILS is still used in %.% — not removed', v_fk.tbl, v_fk.col;
    end if;
  end loop;
  delete from public.currencies where code = 'ILS';
end $$;

-- The public site's currency menu: every currency in the list.
update public.platform_settings
   set supported_currencies = (select array_agg(code::text order by code) from public.currencies);
