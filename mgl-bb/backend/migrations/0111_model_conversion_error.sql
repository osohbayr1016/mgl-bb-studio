-- Short, human-readable reason a model conversion failed (shown in the viewer).
-- Companion to model_xkt_url / model_conversion_status (migration 0067), which
-- are now LIVE again: the IFC->.xkt 3D viewer is back via the ifc-convert/
-- Cloudflare Container.
ALTER TABLE projects ADD COLUMN model_conversion_error TEXT;
