-- =============================================
-- Multi-team calendar announcements: calendar_event_teams junction.
-- ---------------------------------------------
-- Until now a calendar event could target exactly one team via the
-- single `calendar_events.team_id` column (migration 0041): NULL meant
-- "company-wide", a value meant "only that team (plus admins)".
--
-- This junction lets one event target SEVERAL teams at once (the same
-- "one event, many values" shape the `event_dates[]` multi-day support
-- already uses).  Semantics:
--   * NO junction rows for an event  = company-wide (every active user).
--   * 1+ junction rows               = only those teams (plus admins).
--
-- `calendar_events.team_id` is kept as a dead column (same convention as
-- model_xkt_url / accent_color) — reads and writes go through the
-- junction from here on; the old column is no longer consulted.
-- =============================================

CREATE TABLE IF NOT EXISTS calendar_event_teams (
  event_id INTEGER NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  team_id  INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, team_id)
);

CREATE INDEX IF NOT EXISTS idx_cal_event_teams_team ON calendar_event_teams(team_id);

-- Backfill: every event that was scoped to a single team keeps that
-- targeting under the new model.
INSERT OR IGNORE INTO calendar_event_teams (event_id, team_id)
SELECT id, team_id
FROM calendar_events
WHERE team_id IS NOT NULL;
