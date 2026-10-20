-- 0097_user_signature.sql — saved employee signature.
--
-- Each employee can store a signature image once (drawn or uploaded → R2 →
-- /media/<key>).  Meeting-minutes participants linked to a user (members with a
-- user_id) get their signature auto-inserted into the PDF signature block, so a
-- document comes pre-signed instead of needing a hand signature each time.

ALTER TABLE users ADD COLUMN signature_url TEXT;
