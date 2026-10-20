-- Add template selector to projects + per-team blocks for the new
-- "Ажилийн зураг" template.
--
-- projects.template values:
--   'horoolol'      — legacy/default flow: one shared block tree under the
--                     project, with discipline drawings (BA/BB/HAS/…)
--                     hanging off each block.
--   'ajiliin_zurag' — new flow: each chosen team owns its OWN set of
--                     blocks. blocks.team_id is the discriminator the UI
--                     uses to render team-tabs in setup + overview.
--
-- All existing rows backfill to 'horoolol' so the legacy UI keeps working
-- without any data migration.
ALTER TABLE projects
  ADD COLUMN template TEXT NOT NULL DEFAULT 'horoolol';

ALTER TABLE blocks
  ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_blocks_project_team
  ON blocks(project_id, team_id);
