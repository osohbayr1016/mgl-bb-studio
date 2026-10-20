-- =============================================
-- Seed the two block-prefix teams that were missing from 0007_teams.sql:
--   EZ — Эскиз зураг      (sketch design)
--   GT — Гадна тохижилт   (exterior landscaping)
--
-- Both codes already exist as block prefixes in DRAWING_TYPES on the
-- frontend and as preset trees in AdminProjectSetupPage, but without a
-- row in `teams` they can't be picked from the "+ Баг" dropdown on
-- project setup. Idempotent — INSERT OR IGNORE skips existing codes.
-- =============================================

INSERT OR IGNORE INTO teams (code, name_mn, name_en, sort_order) VALUES
  ('EZ', 'Эскиз зураг',    'Sketch Design',        75),
  ('GT', 'Гадна тохижилт', 'Exterior Landscaping', 85);
