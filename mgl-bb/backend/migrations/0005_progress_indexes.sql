-- Speed up "latest progress per task/subtask" lookups used by the projects
-- list + detail endpoints. The old covering indexes on task_id/subtask_id
-- alone force SQLite to sort every match. With date + created_at in the key
-- the "ORDER BY date DESC, created_at DESC LIMIT 1" subqueries become
-- constant-time index scans.
CREATE INDEX IF NOT EXISTS idx_progress_task_latest
  ON progress_entries(task_id, date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_progress_subtask_latest
  ON progress_entries(subtask_id, date DESC, created_at DESC);
