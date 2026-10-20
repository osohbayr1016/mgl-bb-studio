-- =============================================
-- Leave requests: add optional time-of-day range.
-- ---------------------------------------------
-- For sub-day leaves (e.g. "13:00–15:00") the employee can now record
-- the exact window instead of just the total hours.  Both columns are
-- nullable so existing rows / full-day requests stay untouched, and the
-- aggregator keeps reading `hours` as the source of truth.
-- =============================================

ALTER TABLE leave_requests ADD COLUMN start_time TEXT;
ALTER TABLE leave_requests ADD COLUMN end_time   TEXT;
