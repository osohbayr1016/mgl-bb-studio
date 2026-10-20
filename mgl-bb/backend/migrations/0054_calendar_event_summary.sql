-- Short plain-text summary shown between the title and the longer
-- message body on calendar event cards.  Optional; NULL keeps the
-- pre-migration rendering (title + message only).

ALTER TABLE calendar_events ADD COLUMN summary TEXT;
