-- 0055_task_completion_ai.sql
--
-- Adds the schema needed for the "AI task completion summary" feature:
--   * projects.completion_questions  - per-project list of questions a worker
--     must answer when reporting 100%. NULL falls back to a default 3-question
--     set defined in code (so existing projects keep working without a backfill).
--   * progress_entries.completion_qa - JSON object keyed by question id storing
--     the worker's answers for the 100% report that closed the task.
--   * tasks.ai_completion_summary / _at - cached AI-generated summary of the
--     task's notes + completion answers. Written once after a task hits 100%
--     (regenerable via an admin endpoint).

ALTER TABLE projects          ADD COLUMN completion_questions   TEXT;
ALTER TABLE progress_entries  ADD COLUMN completion_qa          TEXT;
ALTER TABLE tasks             ADD COLUMN ai_completion_summary  TEXT;
ALTER TABLE tasks             ADD COLUMN ai_completion_summary_at TEXT;
