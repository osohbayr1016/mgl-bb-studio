-- Google Calendar two-way sync bookkeeping on calendar_events (2026-07-20).
-- google_event_id : mapped Google event id; NULL until first pushed/imported.
-- google_etag     : last-synced Google etag; lets the cron skip our own echoes.
-- google_synced_at: UTC timestamp (CURRENT_TIMESTAMP format) of the last
--                   successful sync for this row. The cron backstop re-pushes
--                   rows where updated_at > google_synced_at.
ALTER TABLE calendar_events ADD COLUMN google_event_id TEXT;
ALTER TABLE calendar_events ADD COLUMN google_etag TEXT;
ALTER TABLE calendar_events ADD COLUMN google_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_calendar_events_google_event_id
  ON calendar_events(google_event_id);
