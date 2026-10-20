-- =============================================================
-- Migration 0036: payroll module
-- =============================================================
--
-- Two tables:
--
--   payroll_periods   — one row per (year, month) pay cycle.  Lifecycle:
--                       draft → reviewed → sent.  Author is a system_admin.
--
--   payroll_entries   — one row per employee per period.  Carries:
--                         * net_salary in MNT cents (INTEGER, no float drift)
--                         * items_json — flexible breakdown:
--                             [{label, amount, kind:'earning'|'deduction'}, ...]
--                         * employee_id_text — raw value from the Excel row,
--                           kept even if the user account is later deleted
--                           so the audit trail stays intact.
--                         * email_at_send / sent_at / send_status —
--                           filled by the send job (idempotent retries).
--
-- Money is stored in cents to dodge IEEE-754 surprises.  All FE/BE
-- conversion happens in one place (`toMNT(cents)`).

CREATE TABLE IF NOT EXISTS payroll_periods (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  year          INTEGER NOT NULL,
  month         INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
  label         TEXT    NOT NULL,                       -- e.g. "2026-04"
  status        TEXT    NOT NULL DEFAULT 'draft'
                CHECK(status IN ('draft','reviewed','sent')),
  created_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT,
  UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_periods_status
  ON payroll_periods(status, year DESC, month DESC);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  period_id         INTEGER NOT NULL
                    REFERENCES payroll_periods(id) ON DELETE CASCADE,
  user_id           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  employee_id_text  TEXT NOT NULL,                      -- raw Excel value
  net_salary        INTEGER NOT NULL,                   -- MNT × 100
  items_json        TEXT NOT NULL DEFAULT '[]',
  note              TEXT,
  email_at_send     TEXT,                               -- snapshot when sent
  sent_at           TEXT,
  send_status       TEXT NOT NULL DEFAULT 'pending'
                    CHECK(send_status IN ('pending','ok','failed','skipped')),
  send_error        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_period
  ON payroll_entries(period_id);
CREATE INDEX IF NOT EXISTS idx_payroll_entries_user
  ON payroll_entries(user_id);
