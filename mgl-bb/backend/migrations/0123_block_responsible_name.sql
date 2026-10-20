-- Block-level "Хариуцагч" as a FREE-TEXT name (superseding the 0122
-- responsible_user_id reference).  Admin/senior type the responsible person's
-- name inline on the block card — no user picker, no computed logic; the card
-- just stores and shows the text.  NULL/'' = unassigned.
-- (The 0122 `responsible_user_id` column is left in place, now unused.)
ALTER TABLE blocks ADD COLUMN responsible_name TEXT;
