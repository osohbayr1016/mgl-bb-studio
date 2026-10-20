-- =============================================================
-- 0221_rules.sql — ХУВИЛБАРТАЙ ДҮРМИЙН ЗАГВАР ба §52-ын ХАМААРЛЫН ИНДЕКС
-- =============================================================
-- ЗОРИЛГО: v2 §10-ын дүрмийн бүтэц + §61-ийн хамаарлын предикат + §62-ын
-- нэгж + §67-ын ноцтой байдал.
--
-- ⚠️ ХАМГИЙН ЧУХАЛ БАГАНА нь `verification_state`.  Тэр нь ГУРАВ ХАВЧИНА:
--   (1) дүгнэлт  — UNVERIFIED дүрэм ХАМГИЙН ИХДЭЭ 'WARNING', ХЭЗЭЭ Ч
--       'VIOLATION' биш.
--   (2) нотолгоо — `evidence_level` нь MODEL_DERIVED болж албадагдана,
--       ХЭЗЭЭ Ч RULE_BACKED биш.
--   (3) эшлэл   — UNVERIFIED дүрэм КОД, ЗААЛТ, ГАРЧИГ ХАРУУЛАХГҮЙ.  Зөвхөн
--       «дотоод шалгуур (эх сурвалж баталгаажаагүй)».
-- Яагаад: revit-mcp/CLAUDE.md:7-11 нь өөрийн тоонуудыг «design-guidance,
-- албан ёсны БНбД-тэй тулгаагүй» гэж зарласан, eval/golden/rules.json нь
-- тэднийг golden болгож хөлдөөхийг ХОРИГЛОСОН.
--
-- ⚠️ РЕЛИЗ N-Д ДҮРЭМ БҮР `UNVERIFIED` — ЭНЭ НЬ ЗӨВ, АЛДАА БИШ.  `rule_clauses`
-- нь албан ёсны баримтаас Л дүүрнэ (эзний шийдвэр Ш4, 2026-08-31), тиймээс
-- доорх CHECK нь дүрэм бүрийг UNVERIFIED-д хорино.  CHECK-ийг ЗӨӨЛРҮҮЛЖ
-- дүрмийг баталгаажсан мэт харагдуулах нь ЭНЭ ФАЙЛЫН БҮХ УТГЫГ УСТГАНА.
--
-- ⚠️ CHECK-ээр албадана: CLAUSE_CITED / HUMAN_VERIFIED дүрэм нь clause_uid,
-- edition_ref, effective_from-гүйгээр ОРШИЖ ЧАДАХГҮЙ.  Баталгааг UI-ийн
-- бичвэр биш, ӨГӨГДЛИЙН САН барина.
--
-- ⚠️ `requires_triggered_json` нь §52-ын хамаарлын индекс.  Үүнийг ОДОО
-- нэмнэ — дараа нэмэх нь өссөн хүснэгт дээр rebuild шаардана.
--
-- ⚠️ ТЭЭВРИЙН ДҮРЭМ: <= 7 statement, блок тайлбаргүй, мөрөн дотор ; -гүй.

CREATE TABLE IF NOT EXISTS rules (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid               TEXT    NOT NULL,
  version                INTEGER NOT NULL DEFAULT 1,
  semantic_hash          TEXT    NOT NULL,
  team_code              TEXT,
  title_mn               TEXT    NOT NULL,
  title_en               TEXT,
  document_uid           TEXT,
  clause_uid             TEXT,
  edition_ref            TEXT,
  effective_from         TEXT,
  verification_state     TEXT    NOT NULL DEFAULT 'UNVERIFIED'
                           CHECK (verification_state IN ('UNVERIFIED','CLAUSE_CITED','HUMAN_VERIFIED')),
  issue_class            TEXT    NOT NULL DEFAULT 'REGULATORY_VIOLATION'
                           CHECK (issue_class IN ('REGULATORY_VIOLATION','MODEL_QUALITY','PROJECT_INCOMPLETENESS','TEAM_STANDARD','UNKNOWN_NEEDS_REVIEW')),
  severity               TEXT    NOT NULL DEFAULT 'MEDIUM'
                           CHECK (severity IN ('CRITICAL','HIGH','MEDIUM','LOW','INFO')),
  unit                   TEXT    NOT NULL DEFAULT 'NONE'
                           CHECK (unit IN ('MM','M','M2','M3','DEG','PCT','COUNT','KG_M3','H','NONE')),
  coordinate_system      TEXT    NOT NULL DEFAULT 'none'
                           CHECK (coordinate_system IN ('none','project','shared','survey')),
  expect_applicable      INTEGER NOT NULL DEFAULT 0 CHECK (expect_applicable IN (0,1)),
  requires_context_json  TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(requires_context_json)),
  applicability_json     TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(applicability_json)),
  check_json             TEXT    NOT NULL DEFAULT '{}' CHECK (json_valid(check_json)),
  requires_params_json   TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(requires_params_json)),
  requires_triggered_json TEXT   NOT NULL DEFAULT '[]' CHECK (json_valid(requires_triggered_json)),
  exceptions_json        TEXT    NOT NULL DEFAULT '[]' CHECK (json_valid(exceptions_json)),
  recommendation_mn      TEXT,
  status                 TEXT    NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft','review','published','retired')),
  authored_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at            TEXT,
  created_at             TEXT    NOT NULL DEFAULT (datetime('now')),
  CHECK (verification_state = 'UNVERIFIED'
         OR (clause_uid IS NOT NULL AND edition_ref IS NOT NULL AND effective_from IS NOT NULL)),
  CHECK (team_code IS NULL OR team_code GLOB '[A-Z][A-Z]*')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rules_uid_version ON rules (rule_uid, version);

CREATE INDEX IF NOT EXISTS idx_rules_team_pub ON rules (team_code, status) WHERE status = 'published';

CREATE INDEX IF NOT EXISTS idx_rules_clause ON rules (clause_uid) WHERE clause_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_rules_severity ON rules (severity, verification_state);

CREATE TABLE IF NOT EXISTS rule_deps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_uid     TEXT    NOT NULL,
  rule_version INTEGER NOT NULL,
  dep_kind     TEXT    NOT NULL
                 CHECK (dep_kind IN ('category','parameter','context','relationship')),
  dep_key      TEXT    NOT NULL,
  change_kind  TEXT    CHECK (change_kind IN ('add','modify','delete')),
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rule_deps_lookup ON rule_deps (dep_kind, dep_key, change_kind);
