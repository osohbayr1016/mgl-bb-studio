-- Backfill email_messages.direction from Gmail's SENT label.
--
-- The previous inferDirection() (lib/emailSync.ts) used
-- `from.includes(mailbox_address)`, a substring heuristic that misclassified
-- ~124 of 4218 rows:
--   * 117 outgoing messages (Gmail SENT label) sent via a send-as alias —
--     whose From did not contain the mailbox's primary address — were stored
--     as 'in'.
--   * 7 incoming messages whose sender address merely CONTAINED the mailbox
--     address as a substring were stored as 'out'.
-- inferDirection now keys on the authoritative SENT label; this recomputes the
-- existing rows the same way. SENT is matched as a delimited token within the
-- comma-joined `label_ids` string so a custom label containing the text "SENT"
-- can't false-match. Only rows whose stored direction is actually wrong are
-- rewritten.
UPDATE email_messages
SET direction = CASE
  WHEN label_ids = 'SENT'
    OR label_ids LIKE 'SENT,%'
    OR label_ids LIKE '%,SENT'
    OR label_ids LIKE '%,SENT,%'
  THEN 'out' ELSE 'in' END
WHERE direction <> (CASE
  WHEN label_ids = 'SENT'
    OR label_ids LIKE 'SENT,%'
    OR label_ids LIKE '%,SENT'
    OR label_ids LIKE '%,SENT,%'
  THEN 'out' ELSE 'in' END);
