-- Daily projects each user marks as "active" (the ones they will work on
-- today).  Captured in the Attendance widget before clock-in so we can
-- track per-day project participation without per-task time tracking.
CREATE TABLE IF NOT EXISTS daily_active_projects (
  user_id    INTEGER NOT NULL REFERENCES users(id),
  date       TEXT    NOT NULL,                       -- UB date 'YYYY-MM-DD'
  project_id INTEGER NOT NULL REFERENCES projects(id),
  created_at TEXT    DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, date, project_id)
);

CREATE INDEX IF NOT EXISTS idx_dap_user_date ON daily_active_projects(user_id, date);
CREATE INDEX IF NOT EXISTS idx_dap_date_project ON daily_active_projects(date, project_id);
