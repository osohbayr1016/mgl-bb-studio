-- Team-scoped calendar announcements.
--
-- Existing rows have `team_id IS NULL` and remain visible to every
-- active user — that's the "company-wide announcement" mode and it's
-- what every event was implicitly before this migration.
--
-- When the admin picks a team from the new dropdown, `team_id` is set
-- to that team's id and only members of that team (plus admins) will
-- see the event on their dashboard / calendar grid.
--
-- ON DELETE SET NULL: dropping a team should not nuke the historical
-- announcements; they fall back to "company-wide" rather than vanish.

ALTER TABLE calendar_events
  ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

-- Date-and-team is the hot lookup path for both /calendar/events and
-- /calendar/today, so a composite index keeps it cheap as the table
-- grows.
CREATE INDEX IF NOT EXISTS idx_calendar_events_date_team
  ON calendar_events(event_date, team_id);
