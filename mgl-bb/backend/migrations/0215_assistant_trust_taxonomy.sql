-- 0215_assistant_trust_taxonomy.sql — ИТГЭЛИЙН ТАКСОНОМИ (1B-7)
--
-- ⚠️ ГОЛ ЗАРЧИМ: `source_type` («хаанаас ирсэн») ба `review_state` («хүн
--    баталсан уу») нь ХОЁР ТУСДАА ТЭНХЛЭГ.  Нэг мөр AI_GENERATED БАС
--    хүнээр баталгаажсан (`review_state = 'verified'`) байж БОЛНО -- энэ нь
--    зөрчил биш, хамгийн энгийн тохиолдол.  Тэднийг нэг багана болгож
--    нийлүүлэх нь энэ миграцийн БҮХ утгыг устгана.  Сургалтад тэнцэх эсэх нь
--    ХОЁУЛАНГИЙНХ нь функц:
--      eligible(row) = policy_allows(row.source_type)
--                      AND row.review_state IN ('reviewed','verified')
--    Бодлогын gate нь энд БИШ, 1B-4-ийн сургалтын манифест дээр хэрэгжинэ.
--
-- ⚠️ 0195:50 «Муу жишээг УСТГАХГҮЙ, унтраана -- юу яагаад хасагдсаныг мэдэх
--    ёстой» гэсэн зорилго нь ХЭРЭГЖЭЭГҮЙ байсан: `is_active`-ыг 0 болгодог
--    код ч, `note`-д бичдэг код ч репод байгаагүй (хэмжсэн 2026-08-28).
--    Энэ миграц + `POST /api/revit/assistant/reject` түүнийг бодит болгоно.
--
-- ⚠️ ЗАН ТӨЛӨВ БАЙТ БАЙТААР ХАДГАЛАГДАНА.  `GET /api/revit/assistant/export`
--    өнөөдөр `WHERE is_active = 1` шүүдэг.  Backfill нь `is_active = 1` бүх
--    мөрийг `review_state = 'verified'` болгоно, тиймээс шинэ шүүлт
--    `review_state IN ('reviewed','verified')` нь ЯГ ИЖИЛ олонлогийг өгнө.
--    `is_active` УСТГАГДАХГҮЙ -- `idx_assistant_ex_intent(intent, is_active)`
--    түүнээс хамаарна, ба роутын код хоёуланг нь СИНХРОН бичнэ.
--
-- ⚠️ Хуучин `source` багана (seed|usage|manual) ҮЛДЭНЭ -- түүхэн талбар.
--    Түүний CHECK-ыг өргөтгөх нь `assistant_examples`-ыг rebuild хийхийг
--    шаардана, тэр нь энэ сесст ХОРИОТОЙ.  `source_type` нь эрх мэдэлтэй.
--
-- ⚠️ SQLite ADD COLUMN дүрэм (локал sqlite 3.49.1 дээр хэмжсэн):
--    CHECK нь ЗӨВШӨӨРӨГДДӨГ (репо дахь 0168/0170/0181-ийн эсрэг тайлбар нь
--    БУРУУ), NOT NULL нь ТОГТМОЛ өгөгдмөлтэй байх ёстой, REFERENCES агуулсан
--    багана өгөгдмөл нь NULL байх ЁСТОЙ, огнооны багананд тогтмол бус
--    DEFAULT (datetime('now')) өгч БОЛОХГҮЙ.  Тиймээс `reviewed_by` ба
--    `origin_log_id` nullable, `reviewed_at` нь энгийн TEXT.
--    Хэрэв D1 CHECK-ыг татгалзвал -> ШИНЭ дугаартай миграц, CHECK-гүйгээр,
--    валидацыг роутын SOURCE_TYPES / REVIEW_STATES тогтмолууд дээр (0168-ийн
--    загвар).  0215-ыг ЗАСАХГҮЙ -- append-only.
--
-- ⚠️ ДАРААЛАЛ: ALTER x5 ЭХЭНД -> UPDATE backfill x2 -> CREATE INDEX.
--    Дунд нь унавал хагас багана үүсэхээс сэргийлнэ.
--    Нийт 8 statement (<= 9), блок тайлбаргүй, мөр дотор нэмэлт таслал цэг байхгүй.
--
-- ⚠️ `users` / `projects` ХӨНДӨГДӨХГҮЙ.  Цэвэр additive ALTER.
--    Эрхийн шийдвэр (1B-7 §9.2, хувилбар A): `HUMAN_VERIFIED`-ыг `isManager`
--    (admin + senior) оноож болно -- одоогийн `POST /assistant/examples`-тэй
--    ЯГ ИЖИЛ эрх, нэмэлт шаталт БАЙХГҮЙ.

-- 1. Эх сурвалжийн таксономи (8 төлөв, эзний тодорхойлолт, өөрчлөхгүй).
--    REVIT_BIM_AI_Architecture_Freeze.md §23-тай БАЙТ БАЙТААР таарна.
ALTER TABLE assistant_examples
  ADD COLUMN source_type TEXT NOT NULL DEFAULT 'UNKNOWN'
    CHECK (source_type IN (
      'HUMAN','HUMAN_CORRECTED','HUMAN_VERIFIED','RULE_VERIFIED',
      'SYNTHETIC','AI_GENERATED','IMPORTED','UNKNOWN'));

-- 2. Хянан үзэх мөчлөг -- ТУСДАА тэнхлэг (Freeze §24-ийн RAW->...->VERIFIED).
--    ⚠️ Өгөгдмөл нь 'verified' -- ЗОРИУД.  'pending' болговол экспорт
--    ХООСРОХ буюу ангилагч талбар дээр эвдэрнэ.
ALTER TABLE assistant_examples
  ADD COLUMN review_state TEXT NOT NULL DEFAULT 'verified'
    CHECK (review_state IN ('pending','reviewed','verified','rejected'));

-- 3. ХЭН баталсан (Freeze §24 «who reviewed»).
ALTER TABLE assistant_examples
  ADD COLUMN reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 4. ХЭЗЭЭ баталсан (Freeze §24 «when reviewed»).  ISO-8601 UTC эсвэл NULL.
ALTER TABLE assistant_examples
  ADD COLUMN reviewed_at TEXT;

-- 5. Гарал үүслийн ХОЛБООС -- аль түүхий бүртгэлээс дэвшсэн бэ.
--    ⚠️ ON DELETE SET NULL: 0195-ийн 90 хоногийн цэвэрлэгээнд бүртгэл
--    устахад ЖИШЭЭ ҮЛДЭХ ёстой, зөвхөн мөр хөтлөгч холбоос тасарна.
ALTER TABLE assistant_examples
  ADD COLUMN origin_log_id INTEGER REFERENCES assistant_logs(id) ON DELETE SET NULL;

-- 6. BACKFILL -- зан төлөвийг байт байтаар хадгална.
--      is_active = 1 -> 'verified'  (өнөөдөр экспортод ОРДОГ)
--      is_active = 0 -> 'rejected'  (өнөөдөр экспортод ОРДОГГҮЙ)
--    Одоогоор 0 болгодог бичигч БАЙХГҮЙ тул хоёрдугаар салаа онолын, гэвч
--    гараар D1 дээр засагдсан мөр байвал түүнийг ч зөв авна.
UPDATE assistant_examples
  SET review_state = CASE WHEN is_active = 1 THEN 'verified' ELSE 'rejected'
  END;

-- 7. Хуучин 3 утгатай `source`-ыг 8 төлөвт БУУЛГАНА.
--      'seed'   -> AI_GENERATED  (хэмжсэн: revit-mcp/training/data-гийн 2532
--                                 мөрийн корпусыг машин зохиож, машин аудитласан)
--      'manual' -> HUMAN         (0195:46 «хүн гараар нэмсэн»)
--      'usage'  -> UNKNOWN       (⚠️ ЗОРИУД.  Дэвшүүлэлтийн зам нь «хүн
--                                 залруулсан» ба «хүн зөвшөөрсөн»-ийг
--                                 ЯЛГАДАГГҮЙ байсан бөгөөд `origin_log_id`
--                                 бичдэггүй байсан тул HUMAN_CORRECTED /
--                                 HUMAN_VERIFIED гэж НЭРЛЭХ БАРИМТ БАЙХГҮЙ.
--                                 Хүний баталгааг зохиох нь таксономийн бүх
--                                 утгыг устгана.)
--    ⚠️ Энэ backfill нь HUMAN_VERIFIED / RULE_VERIFIED / HUMAN_CORRECTED-ыг
--       ХЭЗЭЭ Ч оноохгүй -- анхны бодлогын цөм ЗОРИУД ХООСОН эхэлнэ.
UPDATE assistant_examples
  SET source_type = CASE source
    WHEN 'usage'  THEN 'UNKNOWN'
    WHEN 'manual' THEN 'HUMAN'
    ELSE 'AI_GENERATED'
  END;

-- 8. Сургалтын гол унших хэлбэрийн индекс -- «тэнцэх мөрүүд, санаагаар».
--    ХОЁУЛАНГ нь агуулсан composite.
CREATE INDEX IF NOT EXISTS idx_assistant_ex_trust
  ON assistant_examples(review_state, source_type, intent);
