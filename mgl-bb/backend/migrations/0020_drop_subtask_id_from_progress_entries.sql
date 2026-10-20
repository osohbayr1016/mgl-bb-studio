-- =============================================
-- 0017 dropped the `subtasks` table and re-pointed every progress entry
-- at a task. The `subtask_id` column on `progress_entries` was left
-- behind (nullable, all NULL) along with its FOREIGN KEY → subtasks(id)
-- and the XOR CHECK constraint on (task_id, subtask_id).
--
-- That stale FK is invisible to normal queries (D1 doesn't enforce FKs
-- by default) but trips wrangler when it runs scripts with FK
-- enforcement on, e.g. our cleanup wipes:
--     "no such table: main.subtasks: SQLITE_ERROR"
--
-- SQLite can't ALTER TABLE DROP CONSTRAINT, and it refuses to drop the
-- column while other constraints reference it. The portable fix is the
-- 12-step "rebuild the table" recipe — copy data into a fresh table
-- with the new shape, swap names, recreate indexes.
-- =============================================

CREATE TABLE progress_entries_new (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id),
  percentage    REAL    NOT NULL CHECK(percentage >= 0 AND percentage <= 100),
  date          TEXT    NOT NULL,
  notes         TEXT,
  created_at    TEXT    DEFAULT (datetime('now')),
  status        TEXT    NOT NULL DEFAULT 'approved'
                CHECK(status IN ('pending', 'approved', 'rejected')),
  reviewed_by   INTEGER REFERENCES users(id),
  reviewed_at   TEXT,
  review_note   TEXT,
  image_url     TEXT,
  is_rest_day   INTEGER NOT NULL DEFAULT 0 CHECK(is_rest_day IN (0, 1)),
  defer_next_day INTEGER NOT NULL DEFAULT 0
);

-- Carry forward only rows that already point at a task (which after
-- 0017 should be every row). Anything still tied to a NULL task_id
-- is unreachable data and is dropped here.
INSERT INTO progress_entries_new (
  id, task_id, user_id, percentage, date, notes, created_at,
  status, reviewed_by, reviewed_at, review_note, image_url,
  is_rest_day, defer_next_day
)
SELECT
  id, task_id, user_id, percentage, date, notes, created_at,
  status, reviewed_by, reviewed_at, review_note, image_url,
  is_rest_day, defer_next_day
FROM progress_entries
WHERE task_id IS NOT NULL;

-- Swap. Drop indexes that referenced the old table — they'll be
-- recreated below against the new one.
DROP INDEX IF EXISTS idx_progress_task;
DROP INDEX IF EXISTS idx_progress_user;
DROP INDEX IF EXISTS idx_progress_date;
DROP INDEX IF EXISTS idx_progress_status;
DROP INDEX IF EXISTS idx_progress_task_approved_latest;
DROP INDEX IF EXISTS idx_progress_user_date;

DROP TABLE progress_entries;
ALTER TABLE progress_entries_new RENAME TO progress_entries;

-- Recreate the indexes the app relies on. Mirrors what the original
-- 0001 + 0005 + 0006 migrations set up, minus anything subtask-related.
CREATE INDEX IF NOT EXISTS idx_progress_task         ON progress_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_progress_user         ON progress_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_date         ON progress_entries(date);
CREATE INDEX IF NOT EXISTS idx_progress_status       ON progress_entries(status);
CREATE INDEX IF NOT EXISTS idx_progress_user_date    ON progress_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_progress_task_approved_latest
  ON progress_entries(task_id, created_at DESC)
  WHERE status = 'approved';
