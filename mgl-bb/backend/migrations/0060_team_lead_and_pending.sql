-- 100% task submissions go to a per-team approval queue.
--
-- Each team can designate one user (must have role='senior') as its
-- approval lead via `teams.lead_user_id`.  When an employee submits a
-- progress entry that takes a task to 100%, the entry is written with
-- `status='pending'` (instead of the usual auto-approve) and surfaced
-- in the lead's approvals queue. The lead either approves at 100% or
-- edits the percentage down (e.g. to 90), at which point the entry
-- flips to `status='approved'` at the new percentage and the task
-- reappears on the employee's My Tasks at that lower number.
--
-- ON DELETE SET NULL so deleting a user just clears the assignment;
-- the team itself stays put and can be re-assigned later.

ALTER TABLE teams
  ADD COLUMN lead_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_teams_lead_user_id ON teams (lead_user_id);
