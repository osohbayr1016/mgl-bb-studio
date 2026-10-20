-- =============================================
-- Per-agency "completed" flags for the project
-- status report.  Optional — defaults to 0.
-- =============================================
ALTER TABLE project_status_reports ADD COLUMN nema_done        INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_status_reports ADD COLUMN health_done      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_status_reports ADD COLUMN bdc_experts_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_status_reports ADD COLUMN bdc_review_done  INTEGER NOT NULL DEFAULT 0;
