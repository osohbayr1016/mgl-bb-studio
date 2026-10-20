-- 0126_email_thread_index.sql
--
-- Indexes for the Gmail-style threaded inbox views (GET /api/email/threads
-- and /threads/:threadId).  No column changes — is_read (0087), thread_id
-- (0087) and is_deleted (0088) already exist; this migration only adds the
-- indexes that make thread grouping + thread-detail lookups cheap.

-- Thread-detail: WHERE thread_id = ? AND is_deleted = 0 ORDER BY internal_date.
CREATE INDEX IF NOT EXISTS idx_email_messages_thread
  ON email_messages(thread_id, internal_date);

-- Thread-list grouping: filter is_deleted, partition by thread, latest first.
CREATE INDEX IF NOT EXISTS idx_email_messages_thread_live
  ON email_messages(is_deleted, thread_id, internal_date DESC);
