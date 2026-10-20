-- =============================================
-- BA team architectural explanatory note (Тайлбар бичиг)
-- =============================================
-- One row per project. Stores all the questionnaire answers as a
-- single JSON blob so we can iterate on the template without
-- needing a migration for every new field. The discriminator
-- `building_type` ('rc' | 'steel') is kept as its own column so
-- it can be read/filtered cheaply and to gate section visibility
-- on the form side.

CREATE TABLE IF NOT EXISTS project_ba_report (
  project_id     INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  building_type  TEXT,                             -- 'rc' | 'steel' | NULL
  answers_json   TEXT NOT NULL DEFAULT '{}',
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by_id  INTEGER REFERENCES users(id)
);
