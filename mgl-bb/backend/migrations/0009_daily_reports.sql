-- =============================================
-- Daily reports: image attachment + "rest day" flag + task start dates
-- =============================================
-- Each progress entry now represents a daily report that may include an
-- optional image (photo / evidence) and can be flagged as a "rest day"
-- (the assignee didn't work on this item that day, e.g. Saturday / holiday).

-- 1. Image attachment + rest-day flag on progress_entries
ALTER TABLE progress_entries ADD COLUMN image_url TEXT;
ALTER TABLE progress_entries ADD COLUMN is_rest_day INTEGER NOT NULL DEFAULT 0
  CHECK(is_rest_day IN (0, 1));

-- Rest-day entries are auto-approved (no work claimed, nothing to review).
-- Index helps lookups that ignore rest days when computing current %.
CREATE INDEX IF NOT EXISTS idx_progress_work_only
  ON progress_entries(task_id, subtask_id, status, is_rest_day, date DESC);

-- 2. Optional start_date for tasks + subtasks so the UI can
-- figure out which calendar days are "working days" for a task.
-- If NULL, the task's created_at date is used as the start.
ALTER TABLE tasks ADD COLUMN start_date TEXT;
ALTER TABLE subtasks ADD COLUMN start_date TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_start_date ON tasks(start_date);
CREATE INDEX IF NOT EXISTS idx_subtasks_start_date ON subtasks(start_date);
