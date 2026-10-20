-- 0096_meeting_minutes.sql — structured meeting-minutes (протокол) fields.
--
-- Turns a meeting into a full minutes document: time, location, purpose, a
-- closing/next-meeting note, and structured participants (organisations →
-- members with positions).  The signature block in the PDF is derived from
-- participants.  Existing `attendees` (free text) is kept for backward compat.

ALTER TABLE meetings ADD COLUMN meeting_time TEXT;       -- HH:MM
ALTER TABLE meetings ADD COLUMN location TEXT;           -- Уулзах газар
ALTER TABLE meetings ADD COLUMN purpose TEXT;            -- Уулзалтын зорилго
ALTER TABLE meetings ADD COLUMN conclusion TEXT;         -- Төгсгөл / дараагийн уулзалт
-- JSON: [{ "org": "...", "members": [{ "name": "...", "position": "..." }] }]
ALTER TABLE meetings ADD COLUMN participants_json TEXT;
