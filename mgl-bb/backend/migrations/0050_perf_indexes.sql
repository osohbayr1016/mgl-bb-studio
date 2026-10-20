-- =============================================
-- Phase: Performance index audit
--
-- Three composite indexes covering the admin attendance / leave /
-- overtime report queries.  All three handlers hit the same shape:
--   WHERE status = 'approved'
--     AND <date_col> [overlap]
--     AND user_id IN (... lots of ids ...)
-- so a (user_id, status, <date_col>) composite lets SQLite seek
-- directly to each user's approved-window rows without scanning the
-- single-column user_id index and re-filtering on status/date.
--
-- The existing single-column indexes are kept because they're still
-- the right shape for "give me one user's full leave history" /
-- "find all pending requests" admin queue queries.
-- =============================================

CREATE INDEX IF NOT EXISTS idx_leaves_user_status_start
  ON leave_requests(user_id, status, start_date);

CREATE INDEX IF NOT EXISTS idx_overtime_user_status_work_date
  ON overtime_requests(user_id, status, work_date);

-- Covers "latest progress entries for a user" queries used by the
-- profile page and the activity feed.  (`idx_progress_user_date`
-- already exists on (user_id, date) but doesn't help the very common
-- `WHERE user_id = ? AND status = 'approved' ORDER BY date DESC`
-- pattern as well as a composite that includes status.)
CREATE INDEX IF NOT EXISTS idx_progress_user_status_date
  ON progress_entries(user_id, status, date DESC);
