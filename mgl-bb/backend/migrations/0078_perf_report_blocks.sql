-- =============================================
-- Performance report — block-based composer
-- =============================================
-- Mirrors `landing_blocks` (0075) so reports get the same
-- page→ordered-blocks model the landing CMS uses.
--
-- Each row = one section the admin chose for the PDF (cover,
-- table-of-contents, team-narrative, team-stats, rich-text, …).
-- `type` is opaque to the backend; validation lives on the frontend
-- via `parseBlockContent(type, raw)` so adding a new kind is a
-- no-migration change.
--
-- `position` is stored as 10, 20, 30… (gaps for cheap inserts) and
-- rewritten to (i+1)*10 on every reorder PUT, so we don't accumulate
-- fractional / very-large position values over time.

CREATE TABLE IF NOT EXISTS project_performance_report_blocks (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    INTEGER NOT NULL REFERENCES project_performance_reports(id) ON DELETE CASCADE,
  type         TEXT    NOT NULL,
  position     INTEGER NOT NULL,
  content_json TEXT    NOT NULL DEFAULT '{}',
  hidden       INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_perf_report_blocks_pos
  ON project_performance_report_blocks(report_id, position);
