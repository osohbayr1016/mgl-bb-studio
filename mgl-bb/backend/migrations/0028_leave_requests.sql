-- =============================================
-- Leave requests (чөлөөний хуудас)
-- ---------------------------------------------
-- Lightweight workflow:
--   1. Employee creates a row with status='pending'
--   2. Admin or senior reviews and flips to 'approved' or 'rejected'
--      (writing a reviewer_note + reviewer_id + decided_at)
--   3. Employee can DELETE their own row while still pending; once
--      reviewed it's locked and only an admin can amend.
--
-- We deliberately store the human-typed `days` separately from the
-- (end_date - start_date) span so half-day requests stay accurate
-- without having to model time-of-day on the row.  The admin UI uses
-- `days` for the timesheet aggregate.
--
-- `attendance.absent_today` queries should LEFT JOIN this table and
-- skip users whose approved leave covers today, so the "ирээгүй" list
-- on the admin dashboard doesn't keep yelling about people the
-- company has already excused.
-- =============================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- annual=ээлжийн, sick=өвчтэй, unpaid=цалингүй, remote=зайнаас, other=бусад
  leave_type      TEXT    NOT NULL DEFAULT 'annual'
                  CHECK(leave_type IN ('annual','sick','unpaid','remote','other')),
  start_date      TEXT    NOT NULL,            -- ISO yyyy-mm-dd inclusive
  end_date        TEXT    NOT NULL,            -- ISO yyyy-mm-dd inclusive
  -- Free-form so half days (0.5) and partial weeks (3.5) work without
  -- needing a separate hours column.  Defaults to (end_date-start_date+1)
  -- on the server side when the client doesn't supply it.
  days            REAL    NOT NULL DEFAULT 1,
  reason          TEXT,
  attachment_url  TEXT,                        -- e.g. doctor's note image
  status          TEXT    NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','approved','rejected','cancelled')),
  reviewer_id     INTEGER REFERENCES users(id),
  reviewer_note   TEXT,
  decided_at      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leaves_user      ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leaves_status    ON leave_requests(status);
-- Range filter on the admin "сарын тайлан" — covers (start_date <= ? AND end_date >= ?)
CREATE INDEX IF NOT EXISTS idx_leaves_start     ON leave_requests(start_date);
CREATE INDEX IF NOT EXISTS idx_leaves_end       ON leave_requests(end_date);
