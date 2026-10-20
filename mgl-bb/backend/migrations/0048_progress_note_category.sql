-- Add category column to project_progress_notes so notes can be split
-- between internal MGL work progress ('mgl') and client-related issues ('client').
-- Existing rows default to 'mgl' — no data loss.
ALTER TABLE project_progress_notes ADD COLUMN category TEXT NOT NULL DEFAULT 'mgl';

CREATE INDEX IF NOT EXISTS idx_ppn_category ON project_progress_notes(project_id, category, created_at DESC);
