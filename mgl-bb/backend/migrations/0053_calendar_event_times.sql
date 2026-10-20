-- Optional time range for calendar events.
--
-- When both start_time and end_time are set, the dashboard renders a
-- "HH:MM – HH:MM" badge on the event card so a meeting / deadline can
-- carry a time slot in addition to the calendar day.  NULL on either
-- column means the event is a whole-day announcement (the historical
-- behaviour pre-migration), so existing rows continue to render
-- exactly as before.

ALTER TABLE calendar_events ADD COLUMN start_time TEXT; -- HH:MM or NULL
ALTER TABLE calendar_events ADD COLUMN end_time   TEXT; -- HH:MM or NULL
