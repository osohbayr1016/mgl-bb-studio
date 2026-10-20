-- =============================================
-- Client-facing design-progress report — authored fields
-- =============================================
-- The client report (rendered by WeasyPrint, see backend/src/lib/clientReport*)
-- is built on a performance-report row, but adds three ADMIN-AUTHORED fields
-- that the internal performance report doesn't have. They live here (not as
-- report blocks) because only the WeasyPrint HTML consumes them — the React
-- PdfBlockRenderer is untouched.
--
--   client_summary_md  — executive-summary narrative (plain text / light md)
--   risks_json         — [{ risk, impact: 'green'|'amber'|'red', owner, mitigation }, …]
--   next_plan_json     — ["…", "…"]  (next-period plan bullets)
--
-- All nullable; existing reports keep working with empty client sections.

ALTER TABLE project_performance_reports ADD COLUMN client_summary_md TEXT;
ALTER TABLE project_performance_reports ADD COLUMN risks_json TEXT;
ALTER TABLE project_performance_reports ADD COLUMN next_plan_json TEXT;
