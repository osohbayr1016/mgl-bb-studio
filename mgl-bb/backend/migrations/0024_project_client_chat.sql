-- 0024_project_client_chat.sql
-- =============================================================
-- RECONSTRUCTED BODY — see 0021_pricing.sql for why these four
-- files were empty.
-- =============================================================
-- Unlike the pricing tables, these two survive in production, so this
-- is not guesswork: the DDL below (comments included) is the verbatim
-- `sqlite_master` text taken from a `wrangler d1 export --remote
-- --no-data` of mgl-progress-db. A fresh local database now ends up
-- byte-identical to prod for these tables.
--
-- Per-project, per-discipline chat rooms shared between the client and
-- the team working that discipline.
--
-- IF NOT EXISTS throughout so a replay is a no-op.
-- =============================================================

CREATE TABLE IF NOT EXISTS project_threads (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- One of the standard discipline codes (BA, BB, HAS, TSBU, TSAH, HD,
  -- AU, EZ, IZ, GT). Stored as text to stay independent of the teams
  -- table renumbering and to keep the FK simple.
  team_code   TEXT NOT NULL,
  -- last message timestamp for fast "rooms with new activity" sort.
  last_msg_at TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, team_code)
);

CREATE TABLE IF NOT EXISTS project_thread_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id       INTEGER NOT NULL REFERENCES project_threads(id) ON DELETE CASCADE,
  -- Author. Always a real user (client or engineer/admin); we anonymise
  -- on read for client viewers in the API layer.
  sender_user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Free-form text. Empty allowed when the message is image-only.
  body            TEXT NOT NULL DEFAULT '',
  -- Optional single-image attachment URL produced by /api/upload (R2 key).
  -- Multiple attachments would be a follow-up; one inline image covers
  -- the "share a screenshot / sketch" use case the client asked for.
  attachment_url  TEXT,
  attachment_kind TEXT, -- 'image' | 'file' (text label only, R2 key has the truth)
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Soft-delete so admins / authors can retract a message without losing
  -- the audit trail.
  deleted_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_threads_project
  ON project_threads(project_id);
CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
  ON project_thread_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_thread_messages_sender
  ON project_thread_messages(sender_user_id);
