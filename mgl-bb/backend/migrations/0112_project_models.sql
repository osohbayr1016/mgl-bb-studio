-- IFC model version history for the 3D viewer. Each .ifc upload becomes a dated
-- row with its own converted .xkt, so staff/clients can pick any past revision.
-- projects.model_url / model_xkt_url stay as a denormalised "latest" pointer.
CREATE TABLE IF NOT EXISTS project_models (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id        INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  model_url         TEXT NOT NULL,
  model_xkt_url     TEXT,
  conversion_status TEXT NOT NULL DEFAULT 'converting', -- 'converting' | 'done' | 'failed'
  conversion_error  TEXT,
  file_name         TEXT,
  file_size         INTEGER,
  uploaded_by       INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_models_project
  ON project_models(project_id, created_at DESC);

-- Backfill: one version row per project that already has a model, so the current
-- model shows up as the first version instead of vanishing from the picker.
INSERT INTO project_models (project_id, model_url, model_xkt_url, conversion_status, created_at)
SELECT id, model_url, model_xkt_url,
       COALESCE(model_conversion_status,
                CASE WHEN model_xkt_url IS NOT NULL THEN 'done' ELSE 'converting' END),
       datetime('now')
FROM projects
WHERE model_url IS NOT NULL;
