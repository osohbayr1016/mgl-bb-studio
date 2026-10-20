-- Revit QTO v2 — шифр ангилалтай тоо хэмжээ.
--
-- Эх үүсвэр: Revit 2027 add-in-ий «Тоо хэмжээ илгээх» товч POST /api/qto/revit-runs
-- руу нэгтгэсэн fact мөрүүд (category/family/type/level/material + 5 хэмжигдэхүүн)
-- илгээдэг болсон. Browser web-ifc зам устсан (spec: docs/superpowers/specs/
-- 2026-07-03-revit-qto-integration-design.md). 0110-ийн material_catalog/
-- material_alias/quantity_line-д цаашид бичихгүй (хүснэгтүүд append-only үлдэнэ).
--
-- Дөрвөн зүйл:
--   resources      — mcis.gov.mn-ийн төсвийн шифр каталог (seed нь 0118-д).
--   resource_alias — түүхий нэр → шифр код сурдаг map; AI саналууд НЭГ хүснэгтэд
--                    (status='pending'), батлахад status='confirmed' болж мөр өөрөө
--                    байнгын alias болно.
--   qto_facts      — run бүрийн fact мөрүүд (summary_json-д БИШ, D1-д).
--   qto_runs       — дахин ашиглана: source ('ifc' хуучин | 'revit') + push_id.

CREATE TABLE IF NOT EXISTS resources (
  code        TEXT PRIMARY KEY,             -- '11094248' | '101-0001'
  code_format TEXT NOT NULL CHECK (code_format IN ('digit8','dashed')),
  group_code  TEXT NOT NULL,                -- 3 оронтой бүлэг ('101'…'404'); `group` нь SQL түлхүүр үг
  name        TEXT NOT NULL,                -- Монгол нэр
  unit        TEXT,                         -- норчилсон нэгж ('ш','кг','м³',…); NULL = нэгжгүй
  unit_raw    TEXT,
  flags_json  TEXT NOT NULL DEFAULT '[]',
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resources_group ON resources (group_code);

CREATE TABLE IF NOT EXISTS resource_alias (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_name      TEXT NOT NULL,              -- хүнд харагдах хэлбэр: 'Structural Framing | RHS200X200X5 | STEEL/Q235B'
  raw_norm      TEXT NOT NULL,              -- normalizeFactKey / normalizeRawName гаралт (хайлтын түлхүүр)
  key_kind      TEXT NOT NULL CHECK (key_kind IN ('combo','material')),
  resource_code TEXT NOT NULL REFERENCES resources(code),
  project_id    INTEGER REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = глобал
  source        TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','ai')),
  status        TEXT NOT NULL DEFAULT 'confirmed'
                CHECK (status IN ('pending','confirmed','rejected')),
  confidence    REAL,                       -- AI мөрөнд 0..1
  note          TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 0110-ийн idx_material_alias_uniq-тэй ижил IFNULL trick: глобал (NULL project_id)
-- мөрүүд UNIQUE-д давхцах ёстой → upsert idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_resource_alias_uniq
  ON resource_alias (key_kind, raw_norm, IFNULL(project_id, -1));
CREATE INDEX IF NOT EXISTS idx_resource_alias_lookup ON resource_alias (key_kind, raw_norm, status);
CREATE INDEX IF NOT EXISTS idx_resource_alias_status ON resource_alias (status);

CREATE TABLE IF NOT EXISTS qto_facts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qto_run_id    INTEGER NOT NULL REFERENCES qto_runs(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT '',   -- Revit Category нэр
  family        TEXT NOT NULL DEFAULT '',
  type_name     TEXT NOT NULL DEFAULT '',
  level         TEXT NOT NULL DEFAULT '',
  material      TEXT NOT NULL DEFAULT '',
  count         INTEGER NOT NULL DEFAULT 0,
  length_m      REAL,
  area_m2       REAL,
  volume_m3     REAL,
  mass_kg       REAL,
  combo_key     TEXT NOT NULL,              -- normalizeFactKey(category, type_name, material)
  material_key  TEXT,                       -- normalizeRawName(material); material='' үед NULL
  resource_code TEXT REFERENCES resources(code) ON DELETE SET NULL,  -- NULL = ангилаагүй
  mapped_via    TEXT CHECK (mapped_via IN ('alias','manual')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_qto_facts_run      ON qto_facts (qto_run_id);
CREATE INDEX IF NOT EXISTS idx_qto_facts_unmapped ON qto_facts (project_id, resource_code);
CREATE INDEX IF NOT EXISTS idx_qto_facts_combo    ON qto_facts (combo_key);

ALTER TABLE qto_runs ADD COLUMN source  TEXT NOT NULL DEFAULT 'ifc';  -- 'ifc' (хуучин) | 'revit'
ALTER TABLE qto_runs ADD COLUMN push_id TEXT;                          -- add-in idempotency токен
CREATE UNIQUE INDEX IF NOT EXISTS idx_qto_runs_push
  ON qto_runs (project_id, push_id) WHERE push_id IS NOT NULL;
