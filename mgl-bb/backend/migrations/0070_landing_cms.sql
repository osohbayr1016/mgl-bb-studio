-- =============================================
-- Public landing page CMS.
-- One singleton settings row + three list tables (projects, services, news).
-- All user-visible text is stored bilingually (mn + en) so the public site
-- can render either language without a separate translation pipeline.
-- =============================================

-- Hero, about, and contact info live as a single row keyed by id=1. We use
-- INSERT OR IGNORE on read paths so the row always exists.
CREATE TABLE IF NOT EXISTS landing_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),

  hero_title_mn       TEXT NOT NULL DEFAULT '',
  hero_title_en       TEXT NOT NULL DEFAULT '',
  hero_subtitle_mn    TEXT NOT NULL DEFAULT '',
  hero_subtitle_en    TEXT NOT NULL DEFAULT '',
  hero_image_url      TEXT,         -- background image (R2 /media/<key>)
  hero_video_url      TEXT,         -- optional looping video

  about_title_mn      TEXT NOT NULL DEFAULT '',
  about_title_en      TEXT NOT NULL DEFAULT '',
  about_body_mn       TEXT NOT NULL DEFAULT '',
  about_body_en       TEXT NOT NULL DEFAULT '',
  about_image_url     TEXT,

  contact_phone       TEXT,
  contact_email       TEXT,
  contact_address_mn  TEXT,
  contact_address_en  TEXT,
  facebook_url        TEXT,
  linkedin_url        TEXT,
  instagram_url       TEXT,

  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by          INTEGER REFERENCES users(id)
);

INSERT OR IGNORE INTO landing_settings (id, hero_title_mn, hero_title_en, hero_subtitle_mn, hero_subtitle_en, about_title_mn, about_title_en, about_body_mn, about_body_en)
VALUES (
  1,
  'Маргаашийн хот',
  'City of Tomorrow',
  'Монголын барилгын салбарт инноваци, BIM технологийг нэвтрүүлж буй компани.',
  'Bringing innovation and BIM technology into Mongolia''s construction industry.',
  'Бидний тухай',
  'About us',
  'MGL E&C ХХК нь архитектур, барилга бүтээц, BIM (REVIT, TEKLA) технологид мэргэшсэн компани.',
  'MGL E&C LLC specializes in architecture, structural engineering, and BIM (REVIT, TEKLA) practices.'
);

-- Portfolio cards. `sort_order` lets admins drag-reorder; `published` lets
-- them stage edits without exposing them publicly.
CREATE TABLE IF NOT EXISTS landing_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_mn      TEXT NOT NULL,
  title_en      TEXT NOT NULL DEFAULT '',
  subtitle_mn   TEXT NOT NULL DEFAULT '',
  subtitle_en   TEXT NOT NULL DEFAULT '',
  description_mn TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  location_mn   TEXT,
  location_en   TEXT,
  year          TEXT,
  category_mn   TEXT,          -- e.g. Орон сууц / Worship / Showroom
  category_en   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_landing_projects_pub_order
  ON landing_projects(published, sort_order);

-- Seed the gallery with the projects currently shown on mglenc.com.
-- Image URLs are NULL so the admin must upload them via the CMS — we don't
-- hotlink mglenc.com assets.
INSERT INTO landing_projects (title_mn, title_en, sort_order, category_mn, category_en) VALUES
  ('Stella Vista',                                        'Stella Vista',                              10, 'Орон сууц',    'Residential'),
  ('Gerlug Vista',                                        'Gerlug Vista',                              20, 'Орон сууц',    'Residential'),
  ('Зайсан олон зориулалттай барилга',                    'Zaisan Multi-purpose Building',             30, 'Олон зориулалт','Mixed-use'),
  ('25 давхар үйлчилгээтэй орон сууц',                    '25-story Residential Complex',              40, 'Орон сууц',    'Residential'),
  ('Kaidu Mall — Cinema Next',                            'Kaidu Mall — Cinema Next',                  50, 'Үйлчилгээ',    'Entertainment'),
  ('TOYOTA Showroom',                                     'TOYOTA Showroom',                           60, 'Үйлчилгээ',    'Showroom'),
  ('NUKTH Naran Clubhouse',                               'NUKTH Naran Clubhouse',                     70, 'Үйлчилгээ',    'Clubhouse'),
  ('Encanto Trade Center',                                'Encanto Trade Center',                      80, 'Худалдаа',     'Commercial');

CREATE TABLE IF NOT EXISTS landing_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_mn      TEXT NOT NULL,
  title_en      TEXT NOT NULL DEFAULT '',
  body_mn       TEXT NOT NULL DEFAULT '',
  body_en       TEXT NOT NULL DEFAULT '',
  icon          TEXT,                  -- lucide icon name (e.g. "Layers3")
  sort_order    INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_landing_services_pub_order
  ON landing_services(published, sort_order);

INSERT INTO landing_services (title_mn, title_en, body_mn, body_en, icon, sort_order) VALUES
  ('BIM технологи',
   'BIM Technology',
   'REVIT, TEKLA дээр суурилсан барилгын мэдээллийн загварчлал.',
   'Building Information Modeling built on REVIT and TEKLA.',
   'Layers3', 10),
  ('Архитектурын зураг төсөл',
   'Architectural Design',
   'Уран бүтээлч архитектур, зургийн төсөл боловсруулалт.',
   'Creative architectural design and project development.',
   'Building2', 20),
  ('Барилгын бүтээц',
   'Structural Engineering',
   'Иж бүрэн барилгын бүтээц, тооцоо, зураг төсөл.',
   'End-to-end structural engineering and detailing.',
   'HardHat', 30),
  ('Төслийн менежмент',
   'Project Management',
   'Барилгын явц, ажлын чанарыг хянах дижитал систем.',
   'A digital system to monitor construction progress and quality.',
   'KanbanSquare', 40);

CREATE TABLE IF NOT EXISTS landing_news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title_mn      TEXT NOT NULL,
  title_en      TEXT NOT NULL DEFAULT '',
  excerpt_mn    TEXT NOT NULL DEFAULT '',
  excerpt_en    TEXT NOT NULL DEFAULT '',
  body_mn       TEXT NOT NULL DEFAULT '',
  body_en       TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  published_at  TEXT NOT NULL DEFAULT (datetime('now')),
  published     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_landing_news_pub_date
  ON landing_news(published, published_at DESC);
