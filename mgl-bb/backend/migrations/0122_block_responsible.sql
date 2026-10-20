-- Block-level "Хариуцагч" (responsible person).
--
-- A manually-assigned owner for each block, set by admin/senior, shown as a
-- plain name on the block card.  Any user (typically a member of the block's
-- team) may be assigned; no computed/derived logic — it is just a stored name.
-- NULL = no responsible person assigned.
ALTER TABLE blocks ADD COLUMN responsible_user_id INTEGER REFERENCES users(id);
