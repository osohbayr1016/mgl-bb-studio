-- =============================================
-- Landing CMS v2 — block-based page builder.
--
-- Replaces the rigid 4-table CMS (landing_settings / landing_projects /
-- landing_services / landing_news) with a generic pages+blocks model so
-- admins can add, remove, and reorder sections without code changes.
--
-- The legacy tables stay readable until 0076 drops them; the old
-- /api/landing/public route keeps serving from them for ~2 weeks as a
-- rollback safety net. New code reads /api/landing/v2/public.
--
-- Migration strategy: pure SQL using json_object / json_group_array.
-- Every previously-hardcoded section on LandingPage.tsx (awards, partners,
-- about-stats) becomes a real CMS block here for the first time.
-- =============================================

-- ---- Schema --------------------------------------------------------- --

CREATE TABLE IF NOT EXISTS landing_pages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT NOT NULL UNIQUE,           -- 'home' | 'work/<legacy-id>'
  kind       TEXT NOT NULL,                  -- 'home' | 'project'
  title_mn   TEXT NOT NULL DEFAULT '',       -- admin label / nav title
  title_en   TEXT NOT NULL DEFAULT '',
  meta_json  TEXT NOT NULL DEFAULT '{}',     -- reserved for SEO/OG metadata
  published  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS landing_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id    INTEGER NOT NULL REFERENCES landing_pages(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,                  -- see block-type catalog (frontend/src/types/landingBlocks.ts)
  position   INTEGER NOT NULL,               -- server rewrites on reorder; UI hides it
  content    TEXT NOT NULL DEFAULT '{}',     -- JSON blob; per-type shape
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_landing_blocks_page_pos
  ON landing_blocks(page_id, position);

-- ---- Safety: make sure the legacy settings row exists --------------- --
-- (0070 seeded it, but a fresh DB or partial restore could miss it.)
INSERT OR IGNORE INTO landing_settings (id) VALUES (1);

-- ---- Seed the home page --------------------------------------------- --

INSERT OR IGNORE INTO landing_pages (slug, kind, title_mn, title_en)
VALUES ('home', 'home', 'Нүүр', 'Home');

-- ---- One project page per legacy landing_projects row --------------- --
-- slug='work/<legacy-id>' so existing /work/:id URLs keep resolving.
-- Carries the legacy `published` flag forward.

INSERT OR IGNORE INTO landing_pages (slug, kind, title_mn, title_en, published)
SELECT 'work/' || id, 'project', title_mn, title_en, published
  FROM landing_projects;

-- ============================================================ --
--                    Home page blocks                          --
-- ============================================================ --

-- Subqueries returning JSON values must be wrapped in json() so the outer
-- json_object() treats them as JSON, not as a quoted JSON string.

-- 10. Hero -------------------------------------------------- --
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'hero',
  10,
  json_object(
    'title_mn',     COALESCE(s.hero_title_mn, ''),
    'title_en',     COALESCE(s.hero_title_en, ''),
    'subtitle_mn',  COALESCE(s.hero_subtitle_mn, ''),
    'subtitle_en',  COALESCE(s.hero_subtitle_en, ''),
    'image_url',    s.hero_image_url,
    'video_url',    s.hero_video_url,
    'cta_label_mn', 'Төслүүдийг үзэх',
    'cta_label_en', 'Discover projects',
    'cta_anchor',   'projects'
  )
  FROM landing_settings s WHERE s.id = 1;

-- 20. Project grid ------------------------------------------ --
-- project_page_ids = ordered list of published project page IDs, in
-- legacy sort_order. Admins can later reorder by drag.
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'project-grid',
  20,
  json_object(
    'section_label_mn', 'Сонгомол төслүүд',
    'section_label_en', 'Selected projects',
    'heading_mn',       'Бид Монголын силуэтийг шинэчилж байна.',
    'heading_en',       'Reshaping Mongolia''s skyline.',
    'intro_mn',         'Орон сууцны цогцолбороос үйлдвэрлэлийн объект, иргэний барилга, БНГТ-ын бүтэц хүртэл — нэгдсэн архитектур-инженерийн арга барил.',
    'intro_en',         'From residential towers to industrial facilities, civic buildings and BIM-driven structural systems — one integrated engineering practice.',
    'project_page_ids', json((
      SELECT COALESCE(json_group_array(page_id), json_array())
        FROM (
          SELECT lp.id AS page_id
            FROM landing_pages lp
            JOIN landing_projects p ON lp.slug = 'work/' || p.id
           WHERE p.published = 1
           ORDER BY p.sort_order, p.id
        )
    ))
  )
);

-- 30. Services (Capabilities) ------------------------------- --
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'services',
  30,
  json_object(
    'section_label_mn', 'Чадавхи',
    'section_label_en', 'Capabilities',
    'heading_mn',       'Нэгдсэн инженерчлэл, бүх үе шатанд.',
    'heading_en',       'One practice, every stage.',
    'intro_mn',         'Архитектураас зохион байгуулалт, БНГТ-ын тооцоолол, инженерийн системүүд, барилгын удирдлага хүртэл — нэг багт.',
    'intro_en',         'Architecture, structural & MEP, BIM coordination and project delivery — in one team.',
    'items', json((
      SELECT COALESCE(json_group_array(json_object(
        'title_mn', title_mn,
        'title_en', title_en,
        'body_mn',  body_mn,
        'body_en',  body_en,
        'icon',     icon
      )), json_array())
        FROM (SELECT * FROM landing_services WHERE published = 1 ORDER BY sort_order, id)
    ))
  )
);

-- 40. About -------------------------------------------------- --
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'about',
  40,
  json_object(
    'section_label_mn', 'Бидний тухай',
    'section_label_en', 'About',
    'heading_mn',  COALESCE(s.about_title_mn, ''),
    'heading_en',  COALESCE(s.about_title_en, ''),
    'body_mn',     COALESCE(s.about_body_mn, ''),
    'body_en',     COALESCE(s.about_body_en, ''),
    'image_url',   s.about_image_url
  )
  FROM landing_settings s WHERE s.id = 1;

-- 50. Stats -------------------------------------------------- --
-- Previously hardcoded in LandingPage.tsx. Now editable. Defaults
-- carry forward the exact strings the page used to display.
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'stats',
  50,
  json_object(
    'section_label_mn', '',
    'section_label_en', '',
    'heading_mn',       '',
    'heading_en',       '',
    'tiles', json_array(
      json_object('value', '15+',  'label_mn', 'Жилийн туршлага',     'label_en', 'Years in practice'),
      json_object('value', '60+',  'label_mn', 'Боловсруулсан төсөл', 'label_en', 'Delivered projects'),
      json_object('value', '200+', 'label_mn', 'Инженер, архитектор', 'label_en', 'Engineers & architects'),
      json_object('value', '4',    'label_mn', 'Үндсэн чиглэл',       'label_en', 'Core disciplines')
    )
  )
);

-- 60. Awards (Recognition) ---------------------------------- --
-- Previously hardcoded /landing/award-*.jpg with bilingual taglines.
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'awards',
  60,
  json_object(
    'section_label_mn', 'Шагнал, хүлээн зөвшөөрөл',
    'section_label_en', 'Recognition',
    'heading_mn',       'Мэргэжлийн салбараар хүлээн зөвшөөрөгдсөн.',
    'heading_en',       'Recognised by the industry.',
    'intro_mn',         'Premium Bolor шагналт төслүүдээс эхлээд олон улсын BIM-ийн стандартыг хангасан загвар хүртэл.',
    'intro_en',         'From Premium Bolor laureates to BIM-certified delivery — work that holds up under scrutiny.',
    'items', json_array(
      json_object(
        'title_mn', 'Хөймор', 'title_en', 'Khoimor',
        'tag_mn',   'Premium Bolor 2025 / Шилдэг барилга',
        'tag_en',   'Premium Bolor 2025 / Best building',
        'image_url','/landing/award-khoimor.jpg'
      ),
      json_object(
        'title_mn', 'Kaidu Mall', 'title_en', 'Kaidu Mall',
        'tag_mn',   'Premium Bolor 2025 / Худалдааны барилга',
        'tag_en',   'Premium Bolor 2025 / Commercial',
        'image_url','/landing/award-kaidu.jpg'
      ),
      json_object(
        'title_mn', 'Урт Цагаан', 'title_en', 'Urt Tsagaan',
        'tag_mn',   'Premium Bolor 2025 / Орон сууц',
        'tag_en',   'Premium Bolor 2025 / Residential',
        'image_url','/landing/award-urt-tsagaan.jpg'
      )
    )
  )
);

-- 70. Partners (BIM toolchain) ------------------------------ --
-- Previously hardcoded as /landing/partner-*.png. Now editable.
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'partners',
  70,
  json_object(
    'section_label_mn', 'BIM түншүүд',
    'section_label_en', 'BIM toolchain',
    'heading_mn',       'BIM-ийн стандартаар.',
    'heading_en',       'Designed in BIM.',
    'intro_mn',         'Бид Autodesk Revit, Tekla Structures дээр загварлаж, IFC форматаар хүлээлгэн өгдөг. Нэг загвар — архитектур, бүтэц, инженерийн систем.',
    'intro_en',         'We model in Autodesk Revit and Tekla Structures, then deliver IFC and federated coordination. One source of truth across architecture, structure and MEP.',
    'items', json_array(
      json_object('name', 'Autodesk',        'image_url', '/landing/partner-autodesk.jpg', 'link_url', NULL),
      json_object('name', 'Autodesk Revit',  'image_url', '/landing/partner-revit.png',    'link_url', NULL),
      json_object('name', 'Tekla Structures','image_url', '/landing/partner-tekla.png',    'link_url', NULL)
    )
  )
);

-- 80. News --------------------------------------------------- --
-- Aggregates the legacy landing_news table inline. After 0076 drops the
-- legacy table the admin maintains news items entirely from this block.
INSERT INTO landing_blocks (page_id, type, position, content)
VALUES (
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'news',
  80,
  json_object(
    'section_label_mn', 'Мэдээ, эссэ',
    'section_label_en', 'Newsroom',
    'heading_mn',       'Сүүлийн үеийн мэдээлэл.',
    'heading_en',       'Latest from the studio.',
    'items', json((
      SELECT COALESCE(json_group_array(json_object(
        'title_mn',     title_mn,
        'title_en',     title_en,
        'excerpt_mn',   excerpt_mn,
        'excerpt_en',   excerpt_en,
        'image_url',    image_url,
        'published_at', published_at,
        'link_url',     NULL
      )), json_array())
        FROM (SELECT * FROM landing_news WHERE published = 1 ORDER BY published_at DESC, id DESC LIMIT 12)
    ))
  )
);

-- 90. Contact ------------------------------------------------ --
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  (SELECT id FROM landing_pages WHERE slug = 'home'),
  'contact',
  90,
  json_object(
    'section_label_mn', 'Холбоо барих',
    'section_label_en', 'Contact',
    'heading_mn',       'Хамтран бүтээх боломжтой.',
    'heading_en',       'Let''s build something.',
    'intro_mn',         'Шинэ төсөл, хамтын ажиллагааны санал хүсэлтийг бид нээлттэй хүлээн авна.',
    'intro_en',         'New projects, partnerships and quiet conversations — we''re listening.',
    'phone',            s.contact_phone,
    'email',            s.contact_email,
    'address_mn',       s.contact_address_mn,
    'address_en',       s.contact_address_en,
    'facebook_url',     s.facebook_url,
    'linkedin_url',     s.linkedin_url,
    'instagram_url',    s.instagram_url
  )
  FROM landing_settings s WHERE s.id = 1;

-- ============================================================ --
--                  Per-project page blocks                     --
-- Each project gets 4 blocks:                                  --
--   10 hero, 20 project-credits, 30 rich-text, 40 image-gallery--
-- ============================================================ --

-- 10. Project hero ------------------------------------------ --
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  lp.id,
  'hero',
  10,
  json_object(
    'title_mn',     COALESCE(p.title_mn, ''),
    'title_en',     COALESCE(p.title_en, ''),
    'subtitle_mn',  COALESCE(p.subtitle_mn, ''),
    'subtitle_en',  COALESCE(p.subtitle_en, ''),
    'image_url',    p.image_url,
    'video_url',    NULL,
    'cta_label_mn', '',
    'cta_label_en', '',
    'cta_anchor',   ''
  )
  FROM landing_projects p
  JOIN landing_pages lp ON lp.slug = 'work/' || p.id;

-- 20. Project credits --------------------------------------- --
-- philosophy falls back to settings.project_intro_* when the per-project
-- override is null/empty — same precedence as the legacy detail page.
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  lp.id,
  'project-credits',
  20,
  json_object(
    'name_mn',        COALESCE(p.title_mn, ''),
    'name_en',        COALESCE(p.title_en, ''),
    'typology_mn',    p.typology_mn,
    'typology_en',    p.typology_en,
    'location_mn',    p.location_mn,
    'location_en',    p.location_en,
    'year',           p.year,
    'status_mn',      p.status_mn,
    'status_en',      p.status_en,
    'size_mn',        p.size_mn,
    'size_en',        p.size_en,
    'client_mn',      p.client_mn,
    'client_en',      p.client_en,
    'design_team_mn', p.design_team_mn,
    'design_team_en', p.design_team_en,
    'category_mn',    p.category_mn,
    'category_en',    p.category_en,
    'philosophy_mn',  COALESCE(NULLIF(p.philosophy_mn, ''), s.project_intro_mn, ''),
    'philosophy_en',  COALESCE(NULLIF(p.philosophy_en, ''), s.project_intro_en, '')
  )
  FROM landing_projects p
  JOIN landing_pages lp ON lp.slug = 'work/' || p.id
  CROSS JOIN landing_settings s WHERE s.id = 1;

-- 30. Project description (rich-text) ----------------------- --
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  lp.id,
  'rich-text',
  30,
  json_object(
    'body_mn', COALESCE(p.description_mn, ''),
    'body_en', COALESCE(p.description_en, '')
  )
  FROM landing_projects p
  JOIN landing_pages lp ON lp.slug = 'work/' || p.id;

-- 40. Project image gallery --------------------------------- --
-- gallery_urls is a JSON string array. Coerce malformed/empty/null to [].
INSERT INTO landing_blocks (page_id, type, position, content)
SELECT
  lp.id,
  'image-gallery',
  40,
  json_object(
    'images', json(CASE
      WHEN p.gallery_urls IS NULL
        OR p.gallery_urls = ''
        OR NOT json_valid(p.gallery_urls)
      THEN '[]'
      ELSE COALESCE(
        (SELECT json_group_array(json_object(
            'image_url',  je.value,
            'caption_mn', '',
            'caption_en', ''
         ))
         FROM json_each(p.gallery_urls) je),
        '[]'
      )
    END)
  )
  FROM landing_projects p
  JOIN landing_pages lp ON lp.slug = 'work/' || p.id;
