-- MGL AI · НОРМЫН БОСГЫН ДҮРЭМ (§10, §15)
--
-- ⚠️ ЯАГААД ЭДГЭЭР ДҮРЭМ D1-Д БАЙНА ВЭ.  CLAUDE.md-д «норматив мэдлэг нь
--    D1-д БИШ, ажилтны PC дээрх локал SQLite-д» гэж бичсэн ба тэр нь
--    ХЭВЭЭР ЗӨВ — гэхдээ тэр нь ТЕКСТИЙН КОРПУСТ хамаарна (172+ хэсэг,
--    цаашид мянгаар нэмэгдэнэ, офлайн ажиллах ёстой).
--
--    ЭНЭ ХҮСНЭГТ НЬ ӨӨР ДАВХАРГА: ШИЙДВЭРИЙН босго.  Бүгд 4 мөр.
--    Тэднийг D1-д байлгах ЗААВАЛ шалтгаан:
--      1. Prompt-ыг WORKER угсардаг (`promptFrame.ts` — угсралтын цорын
--         ганц газар).  Шийдвэр prompt-д орох ёстой тул Worker түүнийг
--         МЭДЭХ ёстой.
--      2. Ажилтан локал корпусаа шингээгээгүй байсан ч галын ангиллын
--         асуулт ЗӨВ хариулагдах ёстой — эс тэгвэл «эх сурвалж
--         олдсонгүй» гэсэн дутуу хариу үлдэнэ.
--    Текстийн корпус локалд ХЭВЭЭР — энэ нь түүнийг СОЛИХГҮЙ, НӨХНӨ.
--
-- ⚠️ ЭХ СУРВАЛЖ: ai/data-train-files/MGL_AI_BD_21_101_12_dataset/
--    v_subcategory_rules.jsonl.  Гараар БҮҮ ЗАСВАРЛА — dataset-ээ засаад
--    шинэ миграцаар дахин суулга (0276-г засах нь прод дээр НӨЛӨӨГҮЙ).
--
-- ⚠️ verification_status нь 'verified_from_page_image' байж Л эрх бүхий
--    хариу гарна (`normDecide.ts` → `isVerified`).  Өөр утга нь
--    «хүн шалгах» горим руу оруулна.

CREATE TABLE IF NOT EXISTS norm_threshold_rules (
  rule_id             TEXT PRIMARY KEY,
  document_code       TEXT    NOT NULL,
  document_uid        TEXT    NOT NULL,
  category            TEXT    NOT NULL,
  quantity            TEXT    NOT NULL,
  min_value           REAL,
  max_value           REAL,
  min_exclusive       INTEGER NOT NULL DEFAULT 0 CHECK (min_exclusive IN (0,1)),
  max_exclusive       INTEGER NOT NULL DEFAULT 0 CHECK (max_exclusive IN (0,1)),
  method              TEXT,
  page                INTEGER NOT NULL,
  table_no            INTEGER,
  verification_status TEXT    NOT NULL,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_norm_thr_quantity ON norm_threshold_rules (quantity, document_uid);

-- БД 21-101-12, Хүснэгт 4, хуудас 13 — өрөөний В дэд ангилал
-- ⚠️ В1 нь min_exclusive=1 (g > 2200).  Түүнийг 0 болговол 2200 нь В1 ба
--    В2 ХОЁУЛАНД таарч, `normDecide` нь «өгөгдлийн зөрчил» гэж зогсоно.
INSERT OR REPLACE INTO norm_threshold_rules
  (rule_id, document_code, document_uid, category, quantity, min_value, max_value,
   min_exclusive, max_exclusive, method, page, table_no, verification_status)
VALUES ('BD-21-101-12-2012:room:V1:g', 'БД 21-101-12', 'BD-21-101-12-2012', 'В1',
        'g_mj_m2', 2200, NULL, 1, 0, 'normalization_not_required', 13, 4,
        'verified_from_page_image');

INSERT OR REPLACE INTO norm_threshold_rules
  (rule_id, document_code, document_uid, category, quantity, min_value, max_value,
   min_exclusive, max_exclusive, method, page, table_no, verification_status)
VALUES ('BD-21-101-12-2012:room:V2:g', 'БД 21-101-12', 'BD-21-101-12-2012', 'В2',
        'g_mj_m2', 1401, 2200, 0, 0, 'apply_4_20', 13, 4,
        'verified_from_page_image');

INSERT OR REPLACE INTO norm_threshold_rules
  (rule_id, document_code, document_uid, category, quantity, min_value, max_value,
   min_exclusive, max_exclusive, method, page, table_no, verification_status)
VALUES ('BD-21-101-12-2012:room:V3:g', 'БД 21-101-12', 'BD-21-101-12-2012', 'В3',
        'g_mj_m2', 181, 1400, 0, 0, 'apply_4_20', 13, 4,
        'verified_from_page_image');

INSERT OR REPLACE INTO norm_threshold_rules
  (rule_id, document_code, document_uid, category, quantity, min_value, max_value,
   min_exclusive, max_exclusive, method, page, table_no, verification_status)
VALUES ('BD-21-101-12-2012:room:V4:g', 'БД 21-101-12', 'BD-21-101-12-2012', 'В4',
        'g_mj_m2', 1, 180, 0, 0, '10m2_arbitrary_section_and_spacing', 13, 4,
        'verified_from_page_image');
