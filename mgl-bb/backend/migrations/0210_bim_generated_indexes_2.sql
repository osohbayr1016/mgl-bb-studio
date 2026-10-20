-- =============================================================
-- 0210_bim_generated_indexes_2.sql — 0207-ын GENERATED баганын ИНДЕКСҮҮД (2/2)
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

CREATE INDEX IF NOT EXISTS idx_le_intent
  ON learning_events (intent) WHERE intent IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_le_sheet
  ON learning_events (sheet_uid, occurred_at) WHERE sheet_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_le_rule
  ON learning_events (rule_id, occurred_at) WHERE rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_le_thumbsdown
  ON learning_events (occurred_at) WHERE feedback = -1;

CREATE INDEX IF NOT EXISTS idx_le_progress_entry
  ON learning_events (progress_entry_id) WHERE progress_entry_id IS NOT NULL;

-- revit_element_touches
ALTER TABLE revit_element_touches ADD COLUMN place_level TEXT
  GENERATED ALWAYS AS (json_extract(placement_json, '$.lvl')) VIRTUAL;

CREATE INDEX IF NOT EXISTS idx_ret_level
  ON revit_element_touches (project_id, place_level) WHERE place_level IS NOT NULL;
