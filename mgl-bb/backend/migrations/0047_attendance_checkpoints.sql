-- Attendance project checkpoints for morning / afternoon / clock-out.
-- Each checkpoint stores a timestamp plus a snapshot of selected projects.

CREATE TABLE IF NOT EXISTS attendance_project_checkpoints (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date            TEXT    NOT NULL,
  session_id      INTEGER REFERENCES attendance_sessions(id) ON DELETE SET NULL,
  checkpoint_type TEXT    NOT NULL CHECK (checkpoint_type IN ('morning', 'afternoon', 'clock_out')),
  recorded_at     TEXT    NOT NULL,
  notes           TEXT,
  created_at      TEXT    DEFAULT (datetime('now')),
  UNIQUE (user_id, date, checkpoint_type)
);

CREATE TABLE IF NOT EXISTS attendance_checkpoint_projects (
  checkpoint_id INTEGER NOT NULL REFERENCES attendance_project_checkpoints(id) ON DELETE CASCADE,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  PRIMARY KEY (checkpoint_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_checkpoints_user_date
  ON attendance_project_checkpoints(user_id, date);

CREATE INDEX IF NOT EXISTS idx_attendance_checkpoints_session
  ON attendance_project_checkpoints(session_id);

CREATE INDEX IF NOT EXISTS idx_attendance_checkpoint_projects_project
  ON attendance_checkpoint_projects(project_id);
