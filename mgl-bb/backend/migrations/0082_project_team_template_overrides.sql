-- =============================================
-- Per-project team form template overrides
-- =============================================
-- Each row scopes a JSON patch onto one (project_id, team_code)
-- pair. Replaces the firm-wide `team_template_overrides` (0081)
-- as the source the report shell reads — that table stays in
-- place so any data already entered there isn't lost, but the
-- application no longer reads / writes it.
CREATE TABLE IF NOT EXISTS project_team_template_overrides (
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_code      TEXT    NOT NULL,
  overrides_json TEXT    NOT NULL DEFAULT '{}',
  updated_by_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, team_code)
);

CREATE INDEX IF NOT EXISTS idx_proj_team_tmpl_team
  ON project_team_template_overrides(team_code);
