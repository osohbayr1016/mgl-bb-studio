-- 0088_email_message_soft_delete.sql
--
-- Soft-delete for synced Gmail messages.  Lets admins remove non-work mail
-- from the app's triage list on our own site WITHOUT deleting it from Gmail.
--
-- A tombstone (is_deleted=1) — rather than a hard DELETE — is important
-- because the sync's existence check looks the message up by
-- (account_id, gmail_message_id): a tombstoned row makes the next sync SKIP
-- re-importing the same Gmail message (a hard delete would let the SENT
-- top-up / history-fallback re-add it).

ALTER TABLE email_messages ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- Triage inbox query: not-deleted, untriaged first, newest first.
CREATE INDEX IF NOT EXISTS idx_email_messages_live
  ON email_messages(is_deleted, triaged, internal_date DESC, id DESC);
