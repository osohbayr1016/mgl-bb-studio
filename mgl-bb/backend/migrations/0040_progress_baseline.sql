-- Baseline progress for tasks that were already in flight before the
-- system existed (carry-over from the team's old Excel tracker).
--
-- The admin opens "Бүтэц тохируулах" for a freshly-imported project and
-- types the % a task is already at (e.g. "this one is at 90%, only the
-- final 10% remains").  We don't know who did that work or when, so the
-- baseline entry has no meaningful author/date and must NOT generate
-- leaderboard points.
--
-- Implementation: it's still a normal `progress_entries` row (status =
-- 'approved') so every existing roll-up — project overview, MyTasksPage,
-- "latest approved %" lookups — picks it up for free.  We just flag it
-- with `is_baseline = 1` so the points pipeline can skip it and the
-- admin UI can find/replace the existing baseline cleanly.

ALTER TABLE progress_entries
  ADD COLUMN is_baseline INTEGER NOT NULL DEFAULT 0
  CHECK (is_baseline IN (0, 1));

-- Helps "find the baseline row for this task" be a single index seek
-- when the admin opens the setup page or replaces an existing baseline.
CREATE INDEX IF NOT EXISTS idx_progress_baseline_task
  ON progress_entries(task_id, is_baseline);
