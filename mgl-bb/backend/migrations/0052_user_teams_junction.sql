-- =============================================
-- Multi-team membership: user_teams junction table.
-- ---------------------------------------------
-- An employee can belong to up to 3 teams. One membership is marked
-- `is_primary = 1` (used for grouping in attendance, timesheets, etc.).
-- Existing users.team_id data is migrated into the junction table, then
-- the column is kept temporarily for backward compat — backends should
-- read from user_teams going forward.
-- =============================================

CREATE TABLE IF NOT EXISTS user_teams (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id   INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_user_teams_user ON user_teams(user_id);
CREATE INDEX IF NOT EXISTS idx_user_teams_team ON user_teams(team_id);

-- Migrate existing single-team assignments into the junction table.
INSERT OR IGNORE INTO user_teams (user_id, team_id, is_primary)
SELECT id, team_id, 1
FROM users
WHERE team_id IS NOT NULL;
