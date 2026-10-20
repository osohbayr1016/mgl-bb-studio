-- =============================================
-- Landing project detail page — architectural credits.
-- Adds the editorial credit block that monograph-style project pages need
-- (Typology / Status / Size / Client / Design team) plus a long-form
-- opening "philosophy" paragraph and a multi-image gallery.
--
-- Also seeds a GLOBAL project intro on landing_settings — the same
-- philosophical statement (ecosystem services framing) re-used on every
-- project page unless an individual project overrides it.
-- =============================================

-- ---- Per-project credits ------------------------------------------- --

ALTER TABLE landing_projects ADD COLUMN typology_mn    TEXT;
ALTER TABLE landing_projects ADD COLUMN typology_en    TEXT;
ALTER TABLE landing_projects ADD COLUMN status_mn      TEXT;
ALTER TABLE landing_projects ADD COLUMN status_en      TEXT;
ALTER TABLE landing_projects ADD COLUMN size_mn        TEXT;
ALTER TABLE landing_projects ADD COLUMN size_en        TEXT;
ALTER TABLE landing_projects ADD COLUMN client_mn      TEXT;
ALTER TABLE landing_projects ADD COLUMN client_en      TEXT;
ALTER TABLE landing_projects ADD COLUMN design_team_mn TEXT;
ALTER TABLE landing_projects ADD COLUMN design_team_en TEXT;

-- Per-project override for the opening philosophy paragraph.
-- NULL / '' falls back to landing_settings.project_intro_*.
ALTER TABLE landing_projects ADD COLUMN philosophy_mn  TEXT;
ALTER TABLE landing_projects ADD COLUMN philosophy_en  TEXT;

-- JSON array of /media or https URLs. Rendered as the gallery
-- mosaic between description and pager. Empty array / NULL = no gallery.
ALTER TABLE landing_projects ADD COLUMN gallery_urls   TEXT;

-- ---- Global default project intro ---------------------------------- --

ALTER TABLE landing_settings ADD COLUMN project_intro_mn TEXT NOT NULL DEFAULT '';
ALTER TABLE landing_settings ADD COLUMN project_intro_en TEXT NOT NULL DEFAULT '';

-- Seed the global intro with the studio's regenerative-design statement.
-- Admin can edit it from the Landing CMS Settings tab.
UPDATE landing_settings
   SET project_intro_mn = 'MGL E&C-ийн дизайны арга барил нь байгалийн ухаалаг шийдлээс санаа авч, өгөгдөл дээр тулгуурладаг. Бид төслийн талбайн ус, агаар, нүүрстөрөгч, хөрс, биологийн төрөл зүйл, эрүүл мэнд, сайн сайхны үзүүлэлтүүдийг хэмжихээс эхэлж, ойролцоох жинхэнэ экосистемийн гүйцэтгэлтэй харьцуулдаг. Бидний зорилго — тэр гүйцэтгэлийг дуурайн, тэр ч байтугай давсан, нөхөн сэргээгч төсөл бүтээх явдал юм.',
       project_intro_en = 'MGL E&C''s design approach is inspired by nature''s wisdom but driven by data. We begin by benchmarking the ecosystem services that the site provides — water, air, carbon, soil, biodiversity, and health and well-being — and compare them against a thriving nearby ecosystem. Our goal is to design a regenerative project that emulates and even surpasses those ecosystem performance metrics.'
 WHERE id = 1;
