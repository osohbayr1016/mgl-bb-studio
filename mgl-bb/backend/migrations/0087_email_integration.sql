-- 0087_email_integration.sql — Gmail integration (захидлын автомат бүртгэл)
--
-- Feeds the existing per-project correspondence ledger (migrations 0063/
-- 0064/0066) from real Gmail mailboxes instead of manual screenshot entry.
--
-- Three new tables:
--   * email_accounts     — the 5-10 monitored mailboxes. `auth_type`
--     decides token minting: 'workspace' (service account + domain-wide
--     delegation, no stored secret) vs 'oauth' (plain @gmail, encrypted
--     refresh token).  `history_id` is the Gmail incremental-sync cursor.
--   * email_messages     — raw synced messages, one row per Gmail message.
--     `triaged=0` until an admin classifies it into a project + doc_type;
--     `correspondence_id` links to the ledger row that classification made.
--   * email_attachments  — Gmail attachments copied into R2 (MEDIA_BUCKET),
--     replacing the manual "Gmail screenshot" upload.
--
-- Plus three columns on the existing ledger so a correspondence entry
-- carries a document classification (RFI / CR / Албан бичиг / Meeting
-- Report) and a back-link to the Gmail message it was triaged from.
--
-- doc_type values: 'rfi' | 'cr' | 'official' | 'mr' | NULL (legacy / other).

CREATE TABLE IF NOT EXISTS email_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  address           TEXT    NOT NULL UNIQUE,
  label             TEXT,
  auth_type         TEXT    NOT NULL DEFAULT 'workspace',  -- 'workspace' | 'oauth'
  refresh_token_enc TEXT,                                  -- AES-GCM; oauth only
  history_id        TEXT,                                  -- Gmail sync cursor
  last_synced_at    TEXT,
  last_sync_error   TEXT,
  watch_expiration  TEXT,                                  -- Phase 3 (Pub/Sub)
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_by_id     INTEGER REFERENCES users(id),
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
  gmail_message_id  TEXT    NOT NULL,
  thread_id         TEXT,
  rfc_message_id    TEXT,
  direction         TEXT    NOT NULL DEFAULT 'in',         -- 'in' | 'out'
  from_addr         TEXT,
  to_addrs          TEXT,
  cc_addrs          TEXT,
  subject           TEXT,
  snippet           TEXT,
  body_text         TEXT,
  body_html_r2_key  TEXT,                                  -- large HTML body in R2
  internal_date     TEXT,                                  -- ISO UTC of arrival
  label_ids         TEXT,                                  -- comma-joined Gmail labels
  is_read           INTEGER NOT NULL DEFAULT 0,
  triaged           INTEGER NOT NULL DEFAULT 0,            -- 0 until classified
  correspondence_id INTEGER REFERENCES correspondence_log(id) ON DELETE SET NULL,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);
-- One row per (mailbox, Gmail message) — the sync upserts against this.
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_unique
  ON email_messages(account_id, gmail_message_id);
-- Triage inbox query: untriaged first, newest first.
CREATE INDEX IF NOT EXISTS idx_email_messages_triage
  ON email_messages(triaged, internal_date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_email_messages_account
  ON email_messages(account_id, internal_date DESC);

CREATE TABLE IF NOT EXISTS email_attachments (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id          INTEGER NOT NULL REFERENCES email_messages(id) ON DELETE CASCADE,
  gmail_attachment_id TEXT,
  filename            TEXT,
  mime_type           TEXT,
  size_bytes          INTEGER,
  r2_key              TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_attachments_message
  ON email_attachments(message_id);

-- Extend the existing correspondence ledger.  ADD COLUMN with a REFERENCES
-- clause is allowed in SQLite/D1 only because the default is NULL.
ALTER TABLE correspondence_log ADD COLUMN doc_type TEXT;            -- 'rfi'|'cr'|'official'|'mr'|NULL
ALTER TABLE correspondence_log ADD COLUMN ref_no   TEXT;           -- e.g. RFI-001 (optional)
ALTER TABLE correspondence_log ADD COLUMN email_message_id INTEGER REFERENCES email_messages(id) ON DELETE SET NULL;
