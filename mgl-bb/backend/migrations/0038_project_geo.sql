-- =============================================
-- Project geographic coordinates
-- =============================================
-- Adds optional latitude/longitude to projects so the detail page can
-- render a Leaflet/OSM map pin showing exactly where the building is
-- being constructed. Both columns are nullable; the UI gracefully shows
-- a "set location" placeholder when missing.

ALTER TABLE projects ADD COLUMN latitude REAL;
ALTER TABLE projects ADD COLUMN longitude REAL;
