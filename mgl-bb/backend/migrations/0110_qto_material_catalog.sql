-- QTO материал нэр стандартчлал (Phase 1 schema).
--
-- Гурван хүснэгт:
--   material_catalog — канон материал/марк/профайлын эх сурвалж (глобал).
--   material_alias   — түүхий нэр (summary_json дахь) → канон код буулгах хөдөлгүүр.
--   quantity_line    — qto_runs.summary_json-оос normalize хийсэн, dashboard-д бэлэн мөр.
--
-- summary_json нь materials[] / types[]-г ТУСДАА тэнхлэг болгон хадгалдаг тул
-- quantity_line нь `dimension` ('material'|'type') баганаар тэнхлэг тус бүрийн мөр хадгална.
-- material_catalog нь 0109-ийн material_rates (ҮНИЙН ном)-оос ялгаатай: энэ нь НЭР/маркийн канон.

CREATE TABLE IF NOT EXISTS material_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,            -- канон код: 'Q235B','Q355B','C245','RHS200x200x6.3'
  kind TEXT NOT NULL CHECK (kind IN ('grade','profile')),
  display_name TEXT,                    -- хүний унших нэр (MN/EN)
  category TEXT,                        -- grade: 'steel'|'concrete'|'timber'|'brick'
                                        -- profile: 'i-beam'|'rhs'|'chs'|'angle'|'channel'|'rod'|'plate'|'tee'|'composite'
  standard TEXT,                        -- 'GB'|'GOST'|'ISO'|NULL (ган маркийн стандарт)
  density_kg_m3 REAL,                   -- steel 7850, concrete 2400 … (qto.worker.ts density дүрмээс)
  unit TEXT NOT NULL DEFAULT 'kg',
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS material_alias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_name TEXT NOT NULL,               -- summary_json дахь түүхий мөр, ж: 'КРУГ-30','RHS 200X200X5.0'
  raw_norm TEXT NOT NULL,               -- normalizeRawName(raw_name) — хайлтын түлхүүр (qtoNormalize.ts)
  catalog_id INTEGER NOT NULL REFERENCES material_catalog(id) ON DELETE CASCADE,
  dimension TEXT NOT NULL CHECK (dimension IN ('material','type')),  -- аль тэнхлэгт хамаарах
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,      -- NULL = глобал alias
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','auto')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- NULL project_id-г UNIQUE-д ялгаатай гэж үздэг SQLite-ийн зан тул IFNULL-ээр глобал
-- (project_id NULL) alias-ийн давхардлыг хаана → INSERT OR IGNORE seed нь idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_material_alias_uniq
  ON material_alias (dimension, raw_norm, IFNULL(project_id, -1));
CREATE INDEX IF NOT EXISTS idx_material_alias_lookup ON material_alias (dimension, raw_norm);

CREATE TABLE IF NOT EXISTS quantity_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qto_run_id INTEGER NOT NULL REFERENCES qto_runs(id) ON DELETE CASCADE,  -- аль run-аас (append-only)
  dimension TEXT NOT NULL CHECK (dimension IN ('material','type')),
  raw_name TEXT NOT NULL,               -- ул мөр хадгалах
  catalog_id INTEGER REFERENCES material_catalog(id) ON DELETE SET NULL,  -- NULL = зурагдаагүй
  canonical_code TEXT,                  -- denormalized (хурдан унших), NULL = зурагдаагүй
  category TEXT,                        -- denormalized бүлэглэлт
  cls TEXT,                             -- IFC класс (dimension='type' үед)
  storey TEXT,                          -- одоохондоо NULL/'Undefined' (forward-compat)
  count INTEGER NOT NULL DEFAULT 0,
  volume_m3 REAL,
  mass_kg REAL,
  mapped INTEGER NOT NULL DEFAULT 0,    -- 1 = каталогт зурагдсан, 0 = flag (хянах)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_quantity_line_project ON quantity_line (project_id, qto_run_id);
CREATE INDEX IF NOT EXISTS idx_quantity_line_catalog ON quantity_line (catalog_id);
CREATE INDEX IF NOT EXISTS idx_quantity_line_unmapped ON quantity_line (project_id, mapped);

-- ───────────────────────── Seed: material_catalog ─────────────────────────
-- Тодорхой id-аар (idempotent INSERT OR IGNORE; AUTOINCREMENT нь дараа max+1-ээс үргэлжилнэ).

-- Ган марк (бүрэн). Q235 ба Q235B-г ТУСАД нь (шийдвэр: нэгтгэхгүй).
INSERT OR IGNORE INTO material_catalog (id, code, kind, display_name, category, standard, density_kg_m3, unit) VALUES
  (1, 'Q355B', 'grade', 'Q355B (ган)', 'steel', 'GB',   7850, 'kg'),
  (2, 'Q235B', 'grade', 'Q235B (ган)', 'steel', 'GB',   7850, 'kg'),
  (3, 'Q235',  'grade', 'Q235 (ган)',  'steel', 'GB',   7850, 'kg'),
  (4, 'C245',  'grade', 'C245 (ган)',  'steel', 'GOST', 7850, 'kg');

-- Профайл (төлөөлөл — хөдөлгүүрийг батлах; бүрэн хамрах нь хойшлуулсан).
INSERT OR IGNORE INTO material_catalog (id, code, kind, display_name, category, standard, density_kg_m3, unit) VALUES
  (10, 'RHS200x200x6.3',   'profile', 'RHS 200×200×6.3',   'rhs',     NULL, 7850, 'kg'),
  (11, 'RHS200x200x5.0',   'profile', 'RHS 200×200×5.0',   'rhs',     NULL, 7850, 'kg'),
  (12, 'RHS250x250x8.0',   'profile', 'RHS 250×250×8.0',   'rhs',     NULL, 7850, 'kg'),
  (13, 'RHS50x100x3',      'profile', 'RHS 50×100×3',      'rhs',     NULL, 7850, 'kg'),
  (14, 'CHS140x5',         'profile', 'CHS 140×5',         'chs',     NULL, 7850, 'kg'),
  (15, 'L80x6',            'profile', 'L 80×6',            'angle',   NULL, 7850, 'kg'),
  (16, 'L40x3',            'profile', 'L 40×3',            'angle',   NULL, 7850, 'kg'),
  (17, 'Швеллер200x100x6', 'profile', 'Швеллер 200×100×6', 'channel', NULL, 7850, 'kg'),
  (18, 'KRUG30',           'profile', 'Круг 30',           'rod',     NULL, 7850, 'kg'),
  (19, 'KRUG24',           'profile', 'Круг 24',           'rod',     NULL, 7850, 'kg'),
  (20, 'PL10x143',         'profile', 'PL 10×143',         'plate',   NULL, 7850, 'kg'),
  (21, 'HI300x8x10x200',   'profile', 'HI 300-8-10×200',   'i-beam',  NULL, 7850, 'kg');

-- ───────────────────────── Seed: material_alias (глобал, project_id NULL) ─────────────────────────
-- raw_norm = normalizeRawName(raw_name). Нэг raw_norm-д нэг мөр хангалттай
-- ('STEEL/Q235B' ба 'Q235B' хоёул 'q235b' болдог тул).

-- Марк (dimension='material').
INSERT OR IGNORE INTO material_alias (raw_name, raw_norm, catalog_id, dimension, project_id) VALUES
  ('STEEL/Q355B', 'q355b', 1, 'material', NULL),
  ('STEEL/Q235B', 'q235b', 2, 'material', NULL),
  ('STEEL/Q235',  'q235',  3, 'material', NULL),
  ('STEEL/C245',  'c245',  4, 'material', NULL),
  ('С245',        'с245',  4, 'material', NULL);  -- Кирилл С homoglyph → мөн C245

-- Профайл (dimension='type').
INSERT OR IGNORE INTO material_alias (raw_name, raw_norm, catalog_id, dimension, project_id) VALUES
  ('RHS200*200*6.3',    'rhs200x200x6.3',   10, 'type', NULL),
  ('RHS 200X200X5.0',   'rhs200x200x5',     11, 'type', NULL),
  ('RHS 250X250X8.0',   'rhs250x250x8',     12, 'type', NULL),
  ('RHS50*100*3',       'rhs50x100x3',      13, 'type', NULL),
  ('CHS140X5',          'chs140x5',         14, 'type', NULL),
  ('L80*6',             'l80x6',            15, 'type', NULL),
  ('L40X3',             'l40x3',            16, 'type', NULL),
  ('Швеллер200Х100Х6',  'швеллер200x100x6', 17, 'type', NULL),
  ('КРУГ-30',           'круг30',           18, 'type', NULL),
  ('Круг24',            'круг24',           19, 'type', NULL),
  ('PL10*143',          'pl10x143',         20, 'type', NULL),
  ('HI300-8-10*200',    'hi300x8x10x200',   21, 'type', NULL);
