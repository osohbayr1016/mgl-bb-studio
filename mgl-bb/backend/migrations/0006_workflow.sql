-- =============================================
-- Phase: Approval workflow + due dates + notifications
-- =============================================

-- 1. Progress approval workflow
-- New columns on progress_entries. Existing rows are back-filled to 'approved'
-- so historical data is trusted by default; only new entries submitted by
-- non-admins will require review.
ALTER TABLE progress_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'
  CHECK(status IN ('pending', 'approved', 'rejected'));
ALTER TABLE progress_entries ADD COLUMN reviewed_by INTEGER REFERENCES users(id);
ALTER TABLE progress_entries ADD COLUMN reviewed_at TEXT;
ALTER TABLE progress_entries ADD COLUMN review_note TEXT;

CREATE INDEX IF NOT EXISTS idx_progress_status ON progress_entries(status);
-- Composite index so "latest APPROVED entry" lookups stay fast after the
-- status filter is added to the CTE subqueries.
CREATE INDEX IF NOT EXISTS idx_progress_task_approved_latest
  ON progress_entries(task_id, status, date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_subtask_approved_latest
  ON progress_entries(subtask_id, status, date DESC, created_at DESC);

-- 2. Due dates on tasks + subtasks
ALTER TABLE tasks ADD COLUMN due_date TEXT;
ALTER TABLE subtasks ADD COLUMN due_date TEXT;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_subtasks_due_date ON subtasks(due_date);

-- 3. In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Semantic kind of notification, e.g. 'progress_pending', 'progress_approved',
  -- 'progress_rejected', 'task_assigned'
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  -- Optional deep link the frontend can use to jump to the relevant page.
  link TEXT,
  read INTEGER NOT NULL DEFAULT 0 CHECK(read IN (0, 1)),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);
