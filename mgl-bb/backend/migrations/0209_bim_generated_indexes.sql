-- =============================================================
-- 0209_bim_generated_indexes.sql — 0207-ын GENERATED баганын ИНДЕКСҮҮД (1/2)
-- =============================================================
-- ⚠️ 0207 ЭНЭ ФАЙЛААС ӨМНӨ хэрэгжинэ — индекс нь тэнд нэмсэн багана дээр.
-- ⚠️ Индекслэгдсэн GENERATED баганыг DROP хийхэд ЭХЛЭЭД индексийг устгана.
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ (2026-08-27-нд хаягдах алсын D1 дээр хэмжив).
-- `wrangler d1 migrations apply` нь файлыг d1_migrations-ийн INSERT-тэй
-- залгаад НЭГ --command болгож D1-ийн /query руу илгээдэг.  Тэр задлагч нь
--   (1) блок тайлбарыг (slash-star хэлбэр) ОЙЛГОДОГГҮЙ,
--   (2) мөрөн доторх ; -ээр ХУВААДАГ,
--   (3) нэг дуудлагад олон statement байвал унадаг.
-- Иймд ФАЙЛ БҮР <= 9 statement, блок тайлбаргүй, мөрөн дотор ; -гүй байна.

CREATE INDEX IF NOT EXISTS idx_revit_txn_missing
  ON revit_transactions (received_at) WHERE parts_missing <> 0;

-- learning_events
ALTER TABLE learning_events ADD COLUMN parts_missing INTEGER
  GENERATED ALWAYS AS (parts_expected & ~parts_present) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN intent TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.intent')) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN sheet_uid TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.sheet_uid')) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN rule_id TEXT
  GENERATED ALWAYS AS (json_extract(payload_json, '$.rule_id')) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN feedback INTEGER
  GENERATED ALWAYS AS (json_extract(payload_json, '$.feedback')) VIRTUAL;

ALTER TABLE learning_events ADD COLUMN progress_entry_id INTEGER
  GENERATED ALWAYS AS (json_extract(payload_json, '$.progress_entry_id')) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_le_missing
  ON learning_events (received_at) WHERE parts_missing <> 0;
