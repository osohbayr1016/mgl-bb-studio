-- Drop the project template selector. The `horoolol` flow has been
-- retired and every project now uses the per-team block layout that was
-- formerly the `ajiliin_zurag` template. This migration:
--   1) Coerces any remaining `horoolol` rows to `ajiliin_zurag` so old
--      and new projects share the same rendering path during the brief
--      window where deployed code still reads the column.
--   2) Drops the `template` column entirely. After this migration no
--      code path should reference it; see the matching backend/frontend
--      removals committed alongside.
--
-- Block semantics also change: `blocks.weight_percent` is now "% within
-- its team" (sums to 100 across the blocks that share a `team_id`)
-- instead of "% within the project". Existing data is not rewritten —
-- admins re-balance on the setup page when they next open a project.
UPDATE projects SET template = 'ajiliin_zurag' WHERE template <> 'ajiliin_zurag';
ALTER TABLE projects DROP COLUMN template;
