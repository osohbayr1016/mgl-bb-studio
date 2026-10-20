-- =============================================
-- Per-team explanatory note (Тайлбар бичиг) — generic table
-- =============================================
-- Replaces `project_ba_report` with a team-scoped variant so each
-- discipline assigned to a project (BA, BB, HAS, TSBU, …) can have
-- its own questionnaire + answers blob. The compound primary key
-- (project_id, team_code) lets each team store at most one row
-- per project.
--
-- `team_code` is the canonical short code from the `teams` table
-- (e.g. 'BA'). We deliberately reference by code rather than the
-- numeric team id so the report rows survive a team being reseeded
-- with a new id, and so the API URL can use the human-readable
-- discipline code.
--
-- The previous `project_ba_report` table was just created (and
-- empty in production), so we drop it here rather than migrating
-- data forward.

DROP TABLE IF EXISTS project_ba_report;

CREATE TABLE IF NOT EXISTS project_team_reports (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_code     TEXT    NOT NULL,                  -- e.g. 'BA'
  building_type TEXT,                              -- 'rc' | 'steel' | NULL — only meaningful for BA today
  answers_json  TEXT    NOT NULL DEFAULT '{}',
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by_id INTEGER REFERENCES users(id),
  PRIMARY KEY (project_id, team_code)
);

CREATE INDEX IF NOT EXISTS idx_ptr_project ON project_team_reports(project_id);
