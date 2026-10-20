-- Add the actual email addresses involved in each logged correspondence.
-- Until now we only stored the staff member who logged the entry
-- (`author_id`).  But the "from" / "to" addresses are the real audit
-- trail: who sent the email and who received it.  Both columns are
-- nullable so old rows stay valid; the UI defaults the field that
-- matches our side based on the entry's `direction`.
ALTER TABLE correspondence_log ADD COLUMN from_email TEXT;
ALTER TABLE correspondence_log ADD COLUMN to_email   TEXT;
