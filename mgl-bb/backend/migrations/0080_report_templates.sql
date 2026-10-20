-- =============================================
-- Reusable report templates (Тайлангийн загвар)
-- =============================================
-- A template is a saved block list (cover / TOC / intro / summary
-- with stages+rows / team-narrative / team-stats / rich-text / divider)
-- that admins can pick at report-creation time so new drafts inherit
-- the template's blocks verbatim. After creation the report owns its
-- own copies — editing the template doesn't disturb already-issued
-- reports.
--
-- Schema mirrors `landing_pages` / `landing_blocks` (0075) and
-- `project_performance_report_blocks` (0078): a parent row with an
-- ordered list of typed-JSON blocks underneath.
-- =============================================

CREATE TABLE IF NOT EXISTS report_templates (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  description   TEXT,
  -- 0 = regular, 1 = the firm's default template.  At most one row
  -- should carry is_default=1; the backend enforces this on toggle.
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS report_template_blocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id  INTEGER NOT NULL REFERENCES report_templates(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  position     INTEGER NOT NULL,
  content_json TEXT    NOT NULL DEFAULT '{}',
  hidden       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_report_tmpl_blocks_pos
  ON report_template_blocks(template_id, position);
