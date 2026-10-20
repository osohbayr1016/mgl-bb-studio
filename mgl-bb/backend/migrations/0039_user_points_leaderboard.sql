-- =============================================================
-- 0039_user_points_leaderboard.sql
-- =============================================================
-- Project value × employee performance leaderboard.  Every approved
-- progress_entries row that drives the project's overall progress %
-- forward awards MNT-denominated points to the task's eligible
-- assignees, split equally.  The UI displays a normalised "score"
-- (1 score per 100,000₮) but we keep the canonical MNT amount on
-- the row so admins can audit the cash value.
--
-- Rolling 30-day leaderboard: we never delete or archive rows; the
-- leaderboard query just filters `awarded_at >= datetime('now','-30 days')`.
--
-- See docs:
--   * Plan: project-value-leaderboard
--   * Source of truth for project value: pricing_quotes.total_amount
--     (latest quote for project_id, snapshot at award time)
-- =============================================================

CREATE TABLE IF NOT EXISTS user_points (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id           INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  progress_entry_id INTEGER REFERENCES progress_entries(id) ON DELETE SET NULL,

  -- Canonical ledger value (MNT).  Score is derived: round(amount / 100000).
  amount            REAL    NOT NULL,

  -- Snapshots at award time so historic awards are immutable even if
  -- the quote/project value is later revised.
  delta_pct         REAL    NOT NULL,
  project_value     REAL    NOT NULL,
  assignee_count    INTEGER NOT NULL,

  awarded_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  awarded_by        INTEGER REFERENCES users(id)
);

-- Hot indices for the rolling-window aggregations.
CREATE INDEX IF NOT EXISTS idx_user_points_user_date
  ON user_points(user_id, awarded_at);

CREATE INDEX IF NOT EXISTS idx_user_points_project
  ON user_points(project_id, awarded_at);

CREATE INDEX IF NOT EXISTS idx_user_points_awarded
  ON user_points(awarded_at);
