-- =============================================================
-- 0237_finding_overrides.sql — §68 ГАР ХҮЧИНГҮЙ БОЛГОЛТ
-- =============================================================
-- ЗОРИЛГО: мэргэжлийн инженер дүгнэлттэй санал нийлэхгүй үед түүнийг ХААХ
-- боловч дүгнэлтийг ӨӨРИЙГ нь ХЭЗЭЭ Ч устгахгүй, ЗАСАХГҮЙ.  v2 §68 нь долоон
-- элементийн гинжийг шаарддаг:
--   дүгнэлт -> хүчингүй болголт -> хэн -> хэзээ -> шалтгаан -> нотолгоо
--            -> дүрэм/загварын хувилбар
-- Долоо нь бүгд ЭНЭ хүснэгтэд БАГАНА байна.
--
-- ⚠️ ХҮЧИНГҮЙ БОЛГОЛТ НЬ НЭМЭЛТ, UPDATE БИШ.  compliance_findings (0224) нь
--    ХУВИРАМТГАЙ — §57-ийн шилжилтүүд UPDATE юм.  Аудитын мөрийг ЭНЭ хүснэгт
--    барина: доорх trigger нь бүртгэлийн ХӨДӨЛГӨШГҮЙ ХЭСГИЙГ түгжинэ.
--    Дүгнэлтийн lifecycle_state нь 'DISMISSED' болно; verdict, severity,
--    evidence_level, calc_json, evidence_json нь ХӨНДӨГДӨХГҮЙ.
--
-- ⚠️ ГАДААД ТҮЛХҮҮРИЙН ЗАРЛАЛ ОГТ БАЙХГҮЙ — compliance_findings РУУ Ч,
--    users РУУ Ч.  1B-1 §2.6-д хэмжсэнээр `ON DELETE SET NULL` нь ХҮҮХДИЙН
--    UPDATE болж хувирдаг ба тэр UPDATE нь ХҮҮХДИЙН append-only trigger-ийг
--    асааж, ЭЦГИЙН DELETE-ийг БҮХЭЛД НЬ ABORT хийдэг.
--    ⚠️ ЗАЛРУУЛГА (2-5 хэрэгжүүлэлт, 2026-08-31): 2-5-ийн спек нь
--    `created_by INTEGER REFERENCES users(id) ON DELETE SET NULL`-ыг
--    «users дээр trigger байхгүй тул аюулгүй» гэж зөвшөөрсөн.  Тэр үндэслэл
--    БУРУУ: гал нь ЭЦГИЙН биш, ХҮҮХДИЙН trigger.  users мөр устахад SQLite
--    нь finding_overrides.created_by-г NULL болгож UPDATE хийх ба доорх
--    trigger нь `OLD.reviewed_at IS NOT NULL` мөр дээр RAISE(ABORT) өгнө —
--    улмаар DELETE /api/users/:id БҮХЭЛДЭЭ унана (users нь 19 каскад
--    хүүхэдтэй).  Тиймээс энэ хүснэгт нь 0224 / 0225 / 0229-ийн заншлыг
--    БАЙТ БАЙТААР дагана: энгийн INTEGER + ГАРААР устгах конвенц
--    (email.ts, calendar.ts, pgp.ts, repair.ts).
--
-- ⚠️ finding_id нь ТОГТВОРГҮЙ (мөр гараар устгагдаж болно) тул finding_uid
--    БАС хадгалагдана — 0224-ийн idx_cf_uid нь түүнийг ЦОРЫН ГАНЦ гэж
--    баталгаажуулдаг.  Хоёулаа байх нь давхардал БИШ: id нь ХУРДАН JOIN,
--    uid нь ТОГТВОРТОЙ ТАНИХ.
--
-- ⚠️ dedup_key = sha256(rule_uid || 0x00 || element_uid)-ийн эхний 16 тэмдэгт.
--    ruleset_version нь тэр түлхүүрийн ХЭСЭГ БИШ (0224-ийн шийдэл) — багц
--    дахин нийтлэхэд бүх хүлээн зөвшөөрөл сална.  Хувилбарууд нь ДЭРГЭД нь
--    ТУСДАА багана болж хөлддөг.
--
-- ⚠️ review_state нь 0215:59-61-ийн ДӨРВӨН утгыг БАЙТ БАЙТААР давтана.
--    §68-R4: «An override may become valuable learning data later, but only
--    after appropriate verification» — тав дахь үгсийн сан ҮҮСГЭХГҮЙ.
--    2-6 нь ЗӨВХӨН review_state IN ('reviewed','verified') мөрийг уншина.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (0209:6-12, migrationSchema.test.ts): блок тайлбар
--    БАЙХГҮЙ, мөрөн дотор цэг таслал БАЙХГҮЙ, statement <= 9.
--    Энэ файл: 1 хүснэгт + 2 индекс + 1 trigger = 4 өөрийн statement.
--    Мэдэгдэл бүр нөхцөлт үүсгэлттэй — хагас хэрэгжсэн файл ДАХИН ажиллана.
--
-- ⚠️ END; нь ТОМ ҮСГЭЭР, ӨӨРИЙН МӨРӨНД.  wrangler-ийн салгагчийн regex нь
--    том/жижиг үсэг ЯЛГАНА, буруу бол файл ХАГАС хэрэгжиж d1_migrations мөр
--    БИЧИГДЭХГҮЙ, цорын ганц засвар нь ШИНЭ дугаар.
-- =============================================================

CREATE TABLE IF NOT EXISTS finding_overrides (
  id                          INTEGER PRIMARY KEY AUTOINCREMENT,

  -- 1. АЛЬ ДҮГНЭЛТ.  REFERENCES ЗОРИУД БАЙХГҮЙ (толгойн тайлбар).
  finding_id                  INTEGER NOT NULL,
  finding_uid                 TEXT    NOT NULL DEFAULT '',
  dedup_key                   TEXT    NOT NULL,

  -- 2. ЮУ ГЭСЭН ХҮЧИНГҮЙ БОЛГОЛТ.
  -- ⚠️ FALSE_POSITIVE ба ACCEPTED_RISK-ыг ХЭЗЭЭ Ч НЭГТГЭХГҮЙ: эхнийх нь
  --    ДҮРЭМ буруу, сүүлийнх нь ДҮРЭМ ЗӨВ ч инженер мэдсээр байж давсан.
  --    Нэгтгэвэл §66-ийн худал дохионы хэмжүүр хэмжигдэхээ болино.
  override_kind               TEXT    NOT NULL
    CHECK (override_kind IN (
      'FALSE_POSITIVE','RULE_WRONG','NOT_APPLICABLE_HERE',
      'ACCEPTED_RISK','DESIGN_EXCEPTION','DUPLICATE')),
  -- ⚠️ ШАЛТГААН ЗААВАЛ.  Хоосон шалтгаантай хүчингүй болголт нь §66-д
  --    хэмжигдэхгүй, §70-д тест болохгүй — өөрөөр хэлбэл өгөгдөл БИШ.
  reason                      TEXT    NOT NULL,

  -- 3. НОТОЛГОО.
  evidence_artifact_id        INTEGER,
  evidence_note               TEXT,

  -- 4. ХҮЧИНГҮЙ БОЛГОХ ҮЕИЙН ТӨЛӨВ (ХӨЛДӨӨСӨН, СЕРВЕРЭЭС УНШСАН).
  verdict_at_override         TEXT    NOT NULL,
  severity_at_override        TEXT    NOT NULL,
  evidence_level_at_override  TEXT    NOT NULL,
  issue_class_at_override     TEXT,

  -- 5. ДҮРЭМ / ЗАГВАРЫН ХУВИЛБАР (§68-ийн 7 дахь элемент).
  rule_uid                    TEXT,
  rule_version                INTEGER,
  ruleset_version             TEXT,
  pack_sha256                 TEXT,
  semantic_hash               TEXT,
  model_version               TEXT,
  addin_version               TEXT,
  team_code                   TEXT,

  -- 6. ХЭН, ХЭЗЭЭ.
  created_by                  INTEGER,
  created_at                  TEXT    NOT NULL DEFAULT (datetime('now')),

  -- 7. ХЯНАЛТ (0215-ийн үгсийн сан).  НЭГ УДАА бичигдэнэ.
  review_state                TEXT    NOT NULL DEFAULT 'pending'
    CHECK (review_state IN ('pending','reviewed','verified','rejected')),
  reviewed_by                 INTEGER,
  reviewed_at                 TEXT,
  review_note                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_finding_overrides_finding
  ON finding_overrides (finding_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_finding_overrides_review
  ON finding_overrides (review_state, override_kind, created_at DESC);

-- ⚠️ ЭНЭ TRIGGER НЬ ХОЁР ЗҮЙЛИЙГ НЭГ МЭДЭГДЛЭЭР БАРИНА:
--    (a) хянагдсан мөрийг ДАХИН хянахыг хориглоно (эхний шийдвэр ялна —
--        revit.ts:2397-2403-ийн жишиг), ба
--    (b) хөдөлгөшгүй хагасыг өөрчлөхийг хориглоно.
--    review_state / reviewed_by / reviewed_at / review_note нь НЭГ УДАА
--    бичигдэнэ.  Маршрутын `AND reviewed_at IS NULL` нь ЭХНИЙ давхарга,
--    энэ trigger нь ХОЁР ДАХЬ — гараар D1 дээр UPDATE хийсэн ч барина.
CREATE TRIGGER IF NOT EXISTS finding_overrides_append_only
BEFORE UPDATE ON finding_overrides
WHEN OLD.reviewed_at IS NOT NULL
  OR NEW.finding_id <> OLD.finding_id
  OR NEW.dedup_key <> OLD.dedup_key
  OR NEW.override_kind <> OLD.override_kind
  OR NEW.reason <> OLD.reason
  OR NEW.created_at <> OLD.created_at
  OR NEW.verdict_at_override <> OLD.verdict_at_override
  OR NEW.severity_at_override <> OLD.severity_at_override
  OR NEW.evidence_level_at_override <> OLD.evidence_level_at_override
BEGIN
  SELECT RAISE(ABORT, 'finding_overrides: record is immutable — review may be written once');
END;
