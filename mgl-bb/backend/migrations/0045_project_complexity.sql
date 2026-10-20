-- =============================================================
-- 0045_project_complexity.sql
-- =============================================================
-- Replace the project↔price-quote-driven employee performance score
-- with a single per-project complexity tier:
--   low     = 25 %
--   mid     = 50 %
--   high    = 75 %
--   special = 100 %
--
-- Each progress submission awards `complexity_pct × deltaPct / 100`
-- percentage points, split evenly across the task's assignees.  The
-- whole pricing/quote feature (rates, quotes, line items, adjustments)
-- is removed because the company will track quotes off-platform.
-- =============================================================

-- 1. Add the complexity column.  Default 'mid' so existing rows have
--    a sensible mid-tier value without requiring an admin to backfill
--    every project before the migration finishes.
ALTER TABLE projects
  ADD COLUMN complexity TEXT NOT NULL DEFAULT 'mid';

-- 2. Wipe the leaderboard.  Previous rows are MNT-denominated and the
--    new unit is "percentage points"; mixing them would silently
--    inflate every employee's score.
DELETE FROM user_points;

-- 3. Drop `project_value` from `user_points` — it referenced the now-
--    gone pricing_quotes total.  SQLite supports DROP COLUMN since
--    3.35, which is what Cloudflare D1 ships.
ALTER TABLE user_points DROP COLUMN project_value;

-- 4. Drop pricing tables.  Order matters because of FK references.
DROP TABLE IF EXISTS pricing_quote_items;
DROP TABLE IF EXISTS pricing_quotes;
DROP TABLE IF EXISTS pricing_rates;
DROP TABLE IF EXISTS pricing_complexity_classes;
DROP TABLE IF EXISTS pricing_adjustments;
