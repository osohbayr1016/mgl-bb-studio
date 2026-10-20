-- Хуулбарласан хүлээн авагчид (СС / ВСС) — free-form text column.
-- Stored as a single string so users can paste the list verbatim from
-- their email client (commas, semicolons, newlines, `Name <email>` —
-- all accepted as-is).  No structured CC array because the audit log
-- is human-readable, not actionable.
ALTER TABLE correspondence_log ADD COLUMN cc_emails TEXT;
