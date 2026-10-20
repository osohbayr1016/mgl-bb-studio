-- Correspondence log (И-мэйл бүртгэл) — per-project record of emails
-- exchanged between our staff and the project's client.  Treated like
-- an Excel ledger: one row per email, manually backfilled, never an
-- actual mailer.  Staff write; clients on the same project read-only.
--
-- direction:
--   'sent'     = бид → үйлчлүүлэгч (we sent this email)
--   'received' = үйлчлүүлэгч → бид (we received this email)
--
-- log_date is the date the email was actually sent/received (separate
-- from created_at so old correspondence can be backfilled).
CREATE TABLE IF NOT EXISTS correspondence_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id),
  log_date   TEXT    NOT NULL,
  direction  TEXT    NOT NULL CHECK (direction IN ('sent', 'received')),
  subject    TEXT    NOT NULL,
  body       TEXT,
  attachment_url TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_correspondence_project_date
  ON correspondence_log (project_id, log_date DESC, id DESC);
