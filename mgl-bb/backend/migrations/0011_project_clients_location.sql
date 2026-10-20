-- =============================================
-- Project location + client roster
-- =============================================
-- Projects now carry a free-text location and may have one or more clients.
-- A client is either a company or an individual (хувь хүн), with an
-- ownership/share percentage. Shares should sum to 100% but we don't enforce
-- that at the DB level — the UI warns the admin and still lets them save.

ALTER TABLE projects ADD COLUMN location TEXT;

CREATE TABLE IF NOT EXISTS project_clients (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK(type IN ('company', 'individual')),
  name           TEXT NOT NULL,
  share_percent  REAL NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_clients_project ON project_clients(project_id);
