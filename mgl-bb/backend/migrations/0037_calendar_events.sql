-- Dashboard calendar / announcements feature.
--
-- `calendar_events` stores admin-published broadcast messages or task
-- pointers tied to a specific date.  Every active employee sees them on
-- the dashboard for the matching day.  `task_id` is optional; when set
-- the banner can deep-link to that task.
--
-- `calendar_event_acks` tracks which employees have clicked "Ойлголоо"
-- so admins can see who has acknowledged each announcement.

CREATE TABLE IF NOT EXISTS calendar_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  event_date  TEXT    NOT NULL,                       -- YYYY-MM-DD
  title       TEXT    NOT NULL,
  message     TEXT,
  task_id     INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  priority    TEXT    NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high', 'urgent')),
  created_by  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_calendar_events_date
  ON calendar_events(event_date);

CREATE TABLE IF NOT EXISTS calendar_event_acks (
  event_id        INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_acks_user
  ON calendar_event_acks(user_id);
