-- Project 3D model file (IFC). Stored in R2 via the generic upload route;
-- this column holds the public /media/<key> URL or null if no model uploaded.
ALTER TABLE projects ADD COLUMN model_url TEXT;
