-- =============================================================
-- 0093_project_complexity_pct.sql
-- =============================================================
-- Replace the fixed 4-tier complexity scale (low/mid/high/special ->
-- 25/50/75/100) with a per-project FREE numeric weight an admin types
-- in directly (0-100).  The tier column stays in place for backward
-- compatibility, but scoring now reads `complexity_pct` straight from
-- the project row instead of mapping a tier through COMPLEXITY_PERCENT.
--
-- Each progress submission still awards `complexity_pct x deltaPct / 100`
-- percent points; only the source of `complexity_pct` changes.  Editing a
-- project's percent rebuilds that project's leaderboard ledger (see
-- recalculateProjectPoints).
-- =============================================================

-- 1. Add the numeric weight column.  Default 50 mirrors the legacy 'mid'
--    tier so any project created before an admin sets a value behaves
--    exactly as it did under the old scale.
ALTER TABLE projects
  ADD COLUMN complexity_pct REAL NOT NULL DEFAULT 50;

-- 2. Backfill from the existing tier so no project's score shifts the
--    moment this migration lands.  Unknown/legacy tiers fall back to 50.
UPDATE projects
  SET complexity_pct = CASE complexity
    WHEN 'low'     THEN 25
    WHEN 'mid'     THEN 50
    WHEN 'high'    THEN 75
    WHEN 'special' THEN 100
    ELSE 50
  END;
