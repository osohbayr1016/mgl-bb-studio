-- 0021_pricing.sql
-- =============================================================
-- RECONSTRUCTED BODY — see the note below before editing.
-- =============================================================
-- The original body of this migration was lost: the file has been
-- zero-length ever since commit 1d431bc ("Initial commit: recovered
-- MGL Progress codebase"). Production had already applied it before
-- that recovery, so `d1_migrations` lists it as done and this file is
-- never replayed against prod — but a *fresh* database (every local
-- `wrangler d1 migrations apply --local`) walked into
-- `0023_pricing_table9.sql` and died with
-- "no such table: pricing_complexity_classes". That is why local dev
-- could not be bootstrapped at all.
--
-- What is restored here is exactly — and only — the schema that the
-- later migrations in this chain actually write to:
--   * 0022 / 0023 / 0026 seed `pricing_rates`
--   * 0023 adds the 5th class to `pricing_complexity_classes`
-- Both tables are DROPPED again in `0045_project_complexity.sql`
-- (the whole pricing/quote feature moved off-platform), and no code in
-- `backend/src/` has referenced them since. So this file's only job is
-- to let the chain replay end-to-end; its end state is "gone".
--
-- The original seed *labels* are not recoverable, so the four classes
-- are seeded with their BD 81-16-20 category numerals. Row ids are what
-- matter — 0023/0026 bind rates to complexity_id 1..5.
--
-- Everything is IF NOT EXISTS / OR IGNORE so re-running is a no-op.
-- =============================================================

CREATE TABLE IF NOT EXISTS pricing_complexity_classes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT NOT NULL UNIQUE,
  name_mn    TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- Ids 1..4 — 0023 appends 'special' as id 5.
INSERT OR IGNORE INTO pricing_complexity_classes (id, code, name_mn, sort_order) VALUES
  (1, 'I',   'I зэрэглэл',   1),
  (2, 'II',  'II зэрэглэл',  2),
  (3, 'III', 'III зэрэглэл', 3),
  (4, 'IV',  'IV зэрэглэл',  4);

CREATE TABLE IF NOT EXISTS pricing_rates (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  complexity_id  INTEGER NOT NULL REFERENCES pricing_complexity_classes(id) ON DELETE CASCADE,
  -- Area band. `max_area` is NULL for the open-ended top band
  -- (0026 relies on that).
  min_area       REAL NOT NULL,
  max_area       REAL,
  unit           TEXT NOT NULL DEFAULT 'm2',
  price_per_unit REAL NOT NULL,
  source         TEXT
);

CREATE INDEX IF NOT EXISTS idx_pricing_rates_complexity
  ON pricing_rates(complexity_id, min_area);
