-- 0197_company_stamp_setting.sql — КОМПАНИЙН тамга (`app_settings.report_stamp_url`).
--
-- Яагаад байгууллагын түвшинд вэ (`users.stamp_url` БИШ):
--   Тамга нь компанийнх, гарын үсэг нь хүнийх.  Migration 0173 нь тамгыг
--   хэрэглэгч бүрт өгсөн бөгөөд `lib/signoffSigner.ts` «ажилтанд тамга
--   байхгүй бол ЗАХИРЛЫНХЫГ ав» гэсэн нөхөлттэй байв.  Практикт тэр нөхөлт
--   ҮХМЭЛ: production дээр (2026-08-26 хэмжилт) 9 хүн гарын үсэгтэй, тамгатай
--   нь ГАНЦХАН (id 56), захирлын мөр хоосон.  Иймд гүйцэтгэлийн тайлангийн
--   «Баталгаажуулалт» хуудсанд тамга хэзээ ч гардаггүй байсан.
--
-- Одоо тамга нь лого (`report_logo_url`)-той ЯГ ижил branding тохиргоо:
--   GET /api/settings/branding → { logo_url, stamp_url }   (нэвтэрсэн хэн ч)
--   PUT /api/settings/branding                              (зөвхөн админ)
--
-- ⚠️ `users.stamp_url` баганад ХҮРЭХГҮЙ.  Үнийн саналын PDF (`quotes.ts:1108`
-- дэх `COALESCE(u.stamp_url, ceo.stamp_url)`) ба ASR нь түүнийг хэвээр уншсаар
-- байгаа — тэр хоёрыг энэ өөрчлөлт хөндөөгүй.
--
-- Үр дүн нь ИДЕМПОТЕНТ:
--   • `INSERT … SELECT` нь одоо байгаа тамгатай хэрэглэгчээс замыг авна
--     (хатуу кодоор бичсэн зам БИШ — локал/prod хоёрын түлхүүр өөр).
--   • `WHERE NOT EXISTS` нь админ гараар өөр тамга тохируулсан бол дарж
--     бичихгүй.
--   • Хэрэв нэг ч хэрэглэгч тамгагүй бол ямар ч мөр оруулахгүй — тохиргоо
--     хоосон үлдэж, админ Тохиргоо хуудаснаас хуулна.

INSERT INTO app_settings (key, value)
SELECT 'report_stamp_url', u.stamp_url
  FROM users u
 WHERE u.stamp_url IS NOT NULL
   AND TRIM(u.stamp_url) <> ''
   AND NOT EXISTS (SELECT 1 FROM app_settings s WHERE s.key = 'report_stamp_url')
 ORDER BY u.id
 LIMIT 1;
