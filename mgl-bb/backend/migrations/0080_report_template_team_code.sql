-- =============================================
-- Per-team report templates
-- =============================================
-- Templates can be scoped to a single discipline (BA, BB, HAS, …)
-- so each team curates its own library. `team_code = NULL` keeps a
-- template firm-wide and visible to every team's filtered view.

-- ---------------------------------------------------------------
-- Ordering guard — do not remove.
-- ---------------------------------------------------------------
-- This migration and `0080_report_templates.sql` share the number
-- 0080, and wrangler applies migrations in *filename* order, where
-- '_' (0x5F) sorts before 's' (0x73) — so this file runs FIRST and
-- the ALTER below used to abort a from-scratch replay with
-- "no such table: report_templates". Production is unaffected (both
-- names are already in `d1_migrations`), but every fresh local
-- database hit it.
--
-- Renaming this file is NOT an option: the new name would be absent
-- from production's `d1_migrations` and the ALTER would re-run there
-- and fail on a duplicate column. Instead we create the parent table
-- if it is not there yet. `0080_report_templates.sql` is written with
-- CREATE TABLE IF NOT EXISTS, so whichever runs second is a no-op.
-- Keep the column list below in sync with that file.
CREATE TABLE IF NOT EXISTS report_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE report_templates ADD COLUMN team_code TEXT;

CREATE INDEX IF NOT EXISTS idx_report_templates_team
  ON report_templates(team_code);
