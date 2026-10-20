-- =============================================
-- Per-team progress notes (Тэмдэглэл) — 4-question questionnaire
-- =============================================
-- Replaces the old free-text `project_progress_reports` lists on the
-- Тэмдэглэл sub-tab with a structured per-(project, team) form that
-- mirrors the Тайлбар бичиг layout: one row per discipline, four
-- answers stored as JSON, plus an AI-generated summary cached on the
-- row so the report can quote it without re-running the model.
--
-- The four canonical questions (stored as constants on the frontend
-- and inlined into the AI prompt on the backend) are:
--   q1 — Захиалагчаас бичиг баримт хугацаандаа бүрэн ирсэн үү?
--   q2 — Барилга архитектурын төлөвлөлт ирсэн үү, өөрчлөлт орж байгаа
--        юу? Бусад багаас шалтгаалан хүлээгдэж буй зүйл байгаа юу?
--   q3 — Дээрх асуудлыг шийдсэн үү? Хэрхэн шийдсэн, эсвэл яагаад
--        шийдэгдээгүй байгааг бичнэ үү.
--   q4 — Ажлын зургийн явц төлөвлөгөөт хугацаандаа үргэлжилж байна
--        уу? Хэрэв үгүй бол нэмэлт шаардлагатай зүйл (хүн хүч,
--        хугацаа г.м.) байгаа юу?
--
-- `answers_json` therefore looks like { "q1": "...", "q2": "...", ... }.
-- Storing as JSON instead of four columns means we can adjust the
-- question set without another migration (the frontend will display
-- whichever questions the project's current template lists).
--
-- `ai_summary` / `ai_summary_at` are populated by a `waitUntil`
-- background job after each save, the same pattern as
-- `tasks.ai_completion_summary`.

CREATE TABLE IF NOT EXISTS project_team_notes (
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_code     TEXT    NOT NULL,                  -- e.g. 'BA'
  answers_json  TEXT    NOT NULL DEFAULT '{}',
  ai_summary    TEXT,
  ai_summary_at TEXT,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_by_id INTEGER REFERENCES users(id),
  PRIMARY KEY (project_id, team_code)
);

CREATE INDEX IF NOT EXISTS idx_ptn_project ON project_team_notes(project_id);
