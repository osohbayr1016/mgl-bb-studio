-- Phase 2: priced BOQ (Bill of Quantities / Төсөв).
-- Quantities come from a saved QTO run (qto_runs, migration 0098); prices come
-- from a reusable rate book. ALL access is admin-only at the route layer
-- (routes/boq.ts) — seniors are excluded from pricing (CLAUDE.md), mirroring the
-- quotes feature. (QTO / quantities stays admin+senior; only the priced layer
-- is admin-only.)

-- Reusable unit-price book. The old pricing_rates table was dropped in 0045
-- ("quotes tracked off-platform"); this is a fresh, minimal rate library scoped
-- to material / work-item unit prices for BOQs.
CREATE TABLE IF NOT EXISTS material_rates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'MNT',
  note TEXT,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_material_rates_name ON material_rates (name);

-- One priced BOQ, tied to an immutable QTO run snapshot (qto_runs is
-- append-only, so the quantities never shift under a saved BOQ). qto_run_id is
-- nullable + SET NULL so deleting run history doesn't wipe the priced artifact.
CREATE TABLE IF NOT EXISTS boq (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  qto_run_id INTEGER REFERENCES qto_runs(id) ON DELETE SET NULL,
  title TEXT,
  currency TEXT NOT NULL DEFAULT 'MNT',
  total REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boq_project ON boq (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_boq_run ON boq (qto_run_id);

-- Priced lines. Prices are SNAPSHOT onto the line (unit_price/discount/tax) so
-- later rate-book edits don't rewrite a saved BOQ — same philosophy as
-- qto_runs.model_url being kept per-run. material_rate_id is a soft link only.
CREATE TABLE IF NOT EXISTS boq_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  boq_id INTEGER NOT NULL REFERENCES boq(id) ON DELETE CASCADE,
  material_rate_id INTEGER REFERENCES material_rates(id) ON DELETE SET NULL,
  source_key TEXT,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  tax_pct REAL NOT NULL DEFAULT 0,
  subtotal REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_boq_lines_boq ON boq_lines (boq_id, position);
