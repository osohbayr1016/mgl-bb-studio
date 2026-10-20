-- Per-user accent / palette color.
--
-- NULL = "use the site default" (the theme defined in index.css).
-- Stored as a #rrggbb hex string; validated at the API layer.
-- Applied client-side as a CSS-variable override on :root that retints
-- only the accent tokens (--primary, --ring, --sidebar-primary).  The
-- header and sidebar background intentionally keep the default
-- neutral dark surface so the user-picked color reads as an accent
-- rather than skinning the entire app.
ALTER TABLE users ADD COLUMN accent_color TEXT;
