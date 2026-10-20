-- Тоо хэмжээ (QTO / quantity take-off) runs.
--
-- One row per in-browser QTO computation over a project's .ifc model
-- (web-ifc parses client-side — the Worker can't run an IFC engine).
-- We store only the aggregated summary JSON (materials / classes /
-- storeys / validation flags — a few KB); per-element rows stay in the
-- browser for the Excel export and are never persisted.
--
-- Runs are append-only history: a new upload or re-compute creates a new
-- row, which is what powers the "өмнөх хувилбартай харьцуулах" diff.
CREATE TABLE IF NOT EXISTS qto_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  -- /media/<key> the run was computed from, kept per-run so history stays
  -- traceable to the exact .ifc even after projects.model_url changes.
  model_url TEXT NOT NULL,
  file_name TEXT,
  file_size INTEGER,
  -- IFC schema tag reported by web-ifc (IFC2X3 / IFC4 / ...).
  schema_version TEXT,
  element_count INTEGER NOT NULL DEFAULT 0,
  -- Number of validation findings (see QtoFlag in the frontend) — denormalised
  -- so run lists can show "N анхааруулга" without parsing summary_json.
  flag_count INTEGER NOT NULL DEFAULT 0,
  total_volume_m3 REAL,
  total_area_m2 REAL,
  -- QtoSummary JSON (see frontend/src/features/projects/lib/qtoTypes.ts).
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_qto_runs_project ON qto_runs (project_id, created_at DESC);
