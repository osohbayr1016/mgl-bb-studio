-- Per-project team share allocation (төслийн багийн хуваарь).
--
-- Captures the admin's decision of "for this specific project, how much
-- of the work belongs to each team" as a simple percent breakdown.
--
-- Today this only powers the create-project + admin-setup UI; downstream
-- consumers (progress rollups, leaderboard, dashboard) are intentionally
-- left untouched in this first cut.  Adding rows here has no side-effect
-- on existing routes — they will start reading the table when each
-- feature is migrated to use per-project shares instead of the global
-- PRESET_TEAM_SHARES defaults.
--
-- Design notes
--   * UNIQUE(project_id, team_id) — one row per (project, team) pair.
--     The UI dedupes when adding rows and the PUT endpoint does a
--     replace-all, so duplicates are impossible from the happy path,
--     but we still defend at the schema level.
--   * No CHECK enforcing SUM(share_percent)=100.  Mirrors the
--     project_clients behaviour: the UI surfaces a soft amber warning
--     when the total drifts from 100, but admins can still save
--     in-progress rosters without being blocked.
--   * `share_percent` is stored as REAL because admins routinely use
--     fractional values (e.g. 26.5 for HAS) and rounding here would
--     silently lose precision.
--   * `sort_order` exists so the UI can render rows in a stable order
--     even after team renames.

CREATE TABLE IF NOT EXISTS project_team_shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id    INTEGER NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  share_percent REAL NOT NULL DEFAULT 0
    CHECK(share_percent >= 0 AND share_percent <= 100),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(project_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_pts_project ON project_team_shares(project_id);
