-- APS (Autodesk Platform Services) / SVF2 viewer support for project_models.
-- New uploads are Revit `.rvt` files translated by APS Model Derivative to SVF2
-- and rendered by the APS Viewer. Legacy `.ifc`/`.xkt` rows keep their columns
-- but are no longer rendered (the new viewer switches on model_format='rvt').
-- The existing conversion_status enum is reused: APS manifest
-- pending|inprogress -> 'converting', success -> 'done', failed|timeout -> 'failed'.
ALTER TABLE project_models ADD COLUMN aps_urn TEXT;          -- base64url object URN; NULL for legacy xkt rows
ALTER TABLE project_models ADD COLUMN model_format TEXT NOT NULL DEFAULT 'ifc';  -- 'rvt' (APS) | 'ifc' (legacy xkt)
ALTER TABLE project_models ADD COLUMN aps_progress TEXT;     -- optional manifest progress string ("75% complete")

-- Every existing row predates APS, so it is a legacy xkt row. (DEFAULT 'ifc'
-- already covers new NULLs, but be explicit for any pre-existing NULLs.)
UPDATE project_models SET model_format = 'ifc' WHERE model_format IS NULL;
