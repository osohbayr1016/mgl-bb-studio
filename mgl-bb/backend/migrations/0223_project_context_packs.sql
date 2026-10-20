-- =============================================================
-- 0223_project_context_packs.sql — §61-ийн ХАМААРЛЫН ОРОЛТ ба ДҮРМИЙН БАГЦ
-- =============================================================
-- ЗОРИЛГО: §61 нь 12 оролт дээр хамаарлыг тогтоохыг шаарддаг.  Тэдгээрийн 8
-- нь өнөөдөр ХАДГАЛАХ ГАЗАРГҮЙ.  `projects` дээр багана болж ОРОХГҮЙ — тэр нь
-- 33 cascade хүүхэдтэй бөгөөд rebuild нь ХОРИОТОЙ.  Тиймээс хүүхэд хүснэгт.
--
-- ⚠️ ТҮЛХҮҮР нь (project_id, doc_uid) — нэг төсөлд подиум ба цамхаг тус тусын
-- контексттэй байж БОЛНО.  doc_uid нь Revit баримтын uid-тай ижил мөр,
-- гэхдээ FK БИШ: контекстийг Revit баримт бүртгэгдэхээс ӨМНӨ админ бөглөнө.
--
-- ⚠️ ӨНДРИЙГ ХОСТ БАРИМТААС УНШИХГҮЙ.  HAS / TSBU / TSAH / HD / AU-ийн хост
-- файлд ихэвчлэн Room ч, давхрын Level ч БАЙХГҮЙ (тэдгээр нь холбоос дотор).
-- Хостоос уншвал 5 багийн өндөр барилгын шалгалт БҮГД ЧИМЭЭГҮЙ УНТАРНА.
-- Тиймээс контекстийг АРХИТЕКТОР/АДМИН нэг удаа бичиж, БАГЦТАЙ ХАМТ хүргэнэ.
--
-- ⚠️ height_m нь ЯЛГАВАР, үнэмлэхүй тоо БИШ: дээд давхрын түвшин хасах газрын
-- түвшний давхар.  Revit-ийн ProjectElevation нь shared coordinate дээр
-- Улаанбаатарын ~1300 м газрын өндрийг агуулж болно.
--
-- ⚠️ NULL нь «мэдэхгүй», «үгүй» БИШ.  Тэр ялгаа нь opensHighRiseDocumentSet
-- нь false биш null буцаадгийн БҮХ шалтгаан — NULL → UNCERTAIN →
-- PROJECT_INCOMPLETENESS баннер, ЧИМЭЭГҮЙ PASS БИШ.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS project_build_context (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id            INTEGER NOT NULL,
  doc_uid               TEXT    NOT NULL DEFAULT '',
  building_type         TEXT,
  occupancy_class       TEXT,
  occupant_load         INTEGER,
  gross_area_m2         REAL,
  height_m              REAL,
  height_basis          TEXT    NOT NULL DEFAULT 'unknown'
                          CHECK (height_basis IN ('unknown','levels_diff','manual','proposed')),
  grade_level_name      TEXT,
  top_level_name        TEXT,
  stories_above_grade   INTEGER,
  stories_below_grade   INTEGER,
  jurisdiction          TEXT    NOT NULL DEFAULT 'MN',
  project_phase         TEXT    CHECK (project_phase IN ('concept','sketch','permit','working','asbuilt')),
  fire_safety_class     TEXT,
  seismic_intensity     TEXT,
  room_boundary_location TEXT   CHECK (room_boundary_location IN ('Center','Finish','CoreCenter','CoreBoundary')),
  special_requirements_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(special_requirements_json)),
  authored_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  authored_at           TEXT,
  proposed_json         TEXT    CHECK (proposed_json IS NULL OR json_valid(proposed_json)),
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pbc_project_doc ON project_build_context (project_id, doc_uid);

CREATE INDEX IF NOT EXISTS idx_pbc_height ON project_build_context (height_m, stories_above_grade);

CREATE TABLE IF NOT EXISTS rule_pack_versions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_code       TEXT    NOT NULL,
  ruleset_version TEXT    NOT NULL,
  pack_sha256     TEXT    NOT NULL CHECK (length(pack_sha256) = 64),
  pack_contract   TEXT    NOT NULL DEFAULT 'rulepack-v1',
  rule_count      INTEGER NOT NULL DEFAULT 0,
  body_json       TEXT    NOT NULL CHECK (json_valid(body_json)),
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','published','retired')),
  published_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  published_at    TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pack_team_version ON rule_pack_versions (team_code, ruleset_version);

CREATE INDEX IF NOT EXISTS idx_pack_sha ON rule_pack_versions (pack_sha256);
