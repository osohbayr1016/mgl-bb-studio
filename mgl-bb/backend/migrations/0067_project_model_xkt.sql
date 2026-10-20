-- Pre-converted xeokit `.xkt` URL for the project's 3D model.  The original
-- .ifc upload still lives in `model_url`; this column points at the optimized
-- artifact produced by the converter container.  When set, the viewer skips
-- in-browser IFC parsing entirely and loads the .xkt via XKTLoaderPlugin
-- (~10× faster on large models).
ALTER TABLE projects ADD COLUMN model_xkt_url TEXT;

-- Conversion lifecycle: NULL = never attempted (no model uploaded yet, or
-- model predates this feature), 'pending' = container is converting,
-- 'done' = `model_xkt_url` is valid, 'failed' = give up and fall back to .ifc.
ALTER TABLE projects ADD COLUMN model_conversion_status TEXT;
