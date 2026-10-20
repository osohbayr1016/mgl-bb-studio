-- 0089_project_display_title.sql
--
-- Optional human-friendly display title for a project, editable inline from
-- the project detail header (click the title → dialog).  Falls back to the
-- code-style `name` when NULL.  `name` stays the canonical identifier used
-- everywhere else; this is purely a presentation override on the header.

ALTER TABLE projects ADD COLUMN display_title TEXT;
