-- GET /api/teams/allocation now reads attendance_project_checkpoints by DATE
-- (a single day, or a range up to a year ending on the anchor date) instead of
-- daily_active_projects.  The only index was (user_id, date), so every call
-- was a full scan of attendance_checkpoint_projects (measured: 17 437 rows
-- read for 86 returned on a 7 690-row table).  (date, user_id) serves both
-- the point lookup and the BETWEEN range.
CREATE INDEX IF NOT EXISTS idx_attendance_checkpoints_date
  ON attendance_project_checkpoints(date, user_id);
