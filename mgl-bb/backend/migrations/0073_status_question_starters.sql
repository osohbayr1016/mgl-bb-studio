-- =============================================
-- Status-question sentence starters (clickable chips)
-- =============================================
-- Each team can configure up to 3 "starter" phrases per status
-- question in the universal Тайлангийн товч асуумж block, so editors
-- can click a chip to seed their answer instead of starting from
-- blank.  Per-team because different disciplines tend to phrase
-- "got the drawings from upstream" or "ran into a delay" differently.
--
-- Storage shape: one row per (team_code, question_id), with the up-to-
-- three starters held as a JSON array of strings inside `starters_json`.
-- Going JSON instead of three columns keeps the schema flexible if we
-- later decide some questions want more than three starters — same
-- pattern as `answers_json` on `project_team_notes`.
--
-- `question_id` matches the ids exported from
-- `backend/src/lib/teamReportStatusQuestions.ts` (`q1`..`q5`).  No FK
-- on `team_code` because the `teams` table uses an integer surrogate
-- PK and we key by the short code throughout this feature.

CREATE TABLE IF NOT EXISTS status_question_starters (
  team_code     TEXT    NOT NULL,
  question_id   TEXT    NOT NULL,                        -- 'q1' .. 'q5'
  starters_json TEXT    NOT NULL DEFAULT '[]',           -- JSON: string[] (length 0..3)
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by_id INTEGER REFERENCES users(id),
  PRIMARY KEY (team_code, question_id)
);
