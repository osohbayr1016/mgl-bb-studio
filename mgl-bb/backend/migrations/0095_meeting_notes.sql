-- 0095_meeting_notes.sql — Хурлын тэмдэглэл (meeting notes / voice transcription)
--
-- Staff upload a meeting voice recording → it's stored in the PRIVATE R2 bucket
-- (MEETING_BUCKET, never served via the public /media mount) → submitted to
-- Speechmatics for Mongolian transcription → transcript stored here → analysed
-- (summary / decisions / action items) by Workers AI, and exposed to Claude via
-- the MCP server.
--
-- One meeting = one logical record; recording metadata, transcript and analysis
-- live in satellite tables so a re-transcribe / re-analyse doesn't churn the
-- parent row.  No weights/sums apply here.

CREATE TABLE IF NOT EXISTS meetings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  meeting_date    TEXT,                          -- ISO date of the meeting (UB), nullable
  project_id      INTEGER,                       -- optional link to a project
  attendees       TEXT,                          -- free-text / comma-separated names
  language        TEXT    NOT NULL DEFAULT 'mn', -- Speechmatics language code
  -- lifecycle: uploaded → transcribing → transcribed → analyzing → analyzed
  --            | transcribe_failed | analyze_failed
  status          TEXT    NOT NULL DEFAULT 'uploaded',
  error           TEXT,                          -- last failure detail (operator-facing)
  created_by      INTEGER NOT NULL,              -- users.id of uploader
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS meeting_recordings (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id        INTEGER NOT NULL,
  audio_key         TEXT    NOT NULL,            -- R2 object key in MEETING_BUCKET (private)
  content_type      TEXT,                        -- audio/mpeg, audio/wav, audio/mp4, ...
  size_bytes        INTEGER,
  duration_seconds  REAL,                         -- filled from the Speechmatics job metadata
  -- Speechmatics batch-job tracking
  stt_provider      TEXT    NOT NULL DEFAULT 'speechmatics',
  stt_job_id        TEXT,                         -- /v2/jobs/:id
  stt_status        TEXT,                         -- success | error | fetch_error | trim_error
  submitted_at      TEXT,
  completed_at      TEXT,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id        INTEGER NOT NULL UNIQUE,     -- one transcript per meeting (latest wins)
  language          TEXT,
  transcript_text   TEXT,                         -- speaker-grouped plain text (display / AI input)
  transcript_json   TEXT,                         -- raw Speechmatics json-v2 (audit / re-derive)
  speaker_count     INTEGER,
  word_count        INTEGER,
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS meeting_analyses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  meeting_id        INTEGER NOT NULL UNIQUE,     -- one analysis per meeting (re-run overwrites)
  summary           TEXT,                         -- Mongolian prose summary
  decisions_json    TEXT,                         -- JSON array of decision strings (mn)
  action_items_json TEXT,                         -- JSON array: [{ text, owner?, due? }] (mn)
  model             TEXT,                         -- e.g. @cf/meta/llama-3.1-8b-instruct
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meetings_created_by ON meetings(created_by);
CREATE INDEX IF NOT EXISTS idx_meetings_project    ON meetings(project_id);
CREATE INDEX IF NOT EXISTS idx_meetings_status     ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_mrec_meeting        ON meeting_recordings(meeting_id);
CREATE INDEX IF NOT EXISTS idx_mrec_job            ON meeting_recordings(stt_job_id);
