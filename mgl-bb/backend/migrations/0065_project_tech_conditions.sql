-- Технийн нөхцөл / Technical conditions (per project).
-- Mirrors `project_client_documents` UX-wise but the rows are
-- engineering parameters (water pressure, power capacity, soil class,
-- etc.) rather than documents.  Hence no `status` / `provided_*`
-- columns — these are spec values, not deliverables.
--
-- Columns:
--   title           — e.g. "Цахилгаан хүчин чадал"
--   value           — the actual measurement / value
--   description     — free-form notes
--   condition_date  — when this condition was issued (YYYY-MM-DD)
--   sort_order      — admin-controlled ordering
CREATE TABLE IF NOT EXISTS project_tech_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  title          TEXT    NOT NULL,
  value          TEXT,
  description    TEXT,
  condition_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tech_conditions_project
  ON project_tech_conditions (project_id, sort_order, id);
