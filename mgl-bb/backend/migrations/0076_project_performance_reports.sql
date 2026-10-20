-- =============================================
-- Project performance reports — periodic consolidated PDFs
-- =============================================
-- One row per "Гүйцэтгэлийн тайлан №N" the office issues to a client.
-- `project_status_reports` (0031) is a single-row-per-project digest of
-- current state; this table is the OPPOSITE — many rows per project,
-- each frozen at issue time so a customer asking for "Report №01" in
-- six months gets exactly the numbers we sent the first time.
--
-- Workflow:
--   1. Admin creates a draft (`status='draft'`).  Period dates, the
--      meeting schedule, and notes are editable.
--   2. Admin clicks "Гарга" — the server reads the current project
--      hierarchy, computes per-team rollups, writes them into
--      `team_progress_json`, sets `status='issued'`, `issued_at=now()`.
--   3. From that moment the row is read-only.  PUT/DELETE 409.
--   4. PDF is rendered on demand from the snapshotted columns +
--      passport/document/tech-condition data that the report only
--      *references* (those are live; the report doesn't snapshot them
--      because they're slow-changing and version-controlled by their
--      own audit columns).
--
-- `team_progress_json` shape:
--   [{ team_id, team_code, team_name_mn, share_percent, progress }, …]
-- `status_meetings_json` shape:
--   [{ label, percent, scheduled_at, completed_at? }, …]

CREATE TABLE IF NOT EXISTS project_performance_reports (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id           INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_no            INTEGER NOT NULL,
  period_start         TEXT    NOT NULL,
  period_end           TEXT    NOT NULL,
  status               TEXT    NOT NULL DEFAULT 'draft',
  issued_at            TEXT,
  issued_by_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  team_progress_json   TEXT,
  status_meetings_json TEXT,
  notes                TEXT,
  created_by_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, report_no)
);

CREATE INDEX IF NOT EXISTS idx_perf_reports_project
  ON project_performance_reports(project_id);
