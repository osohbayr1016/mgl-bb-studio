-- One-off: wire the curated marketing assets uploaded to R2 into the CMS.
-- Re-runnable; uses idempotent UPDATEs keyed by title.

UPDATE landing_settings
   SET hero_image_url = '/media/landing-hero-cover.jpg',
       hero_video_url = '/media/landing-hero-video.mp4',
       updated_at     = datetime('now')
 WHERE id = 1;

UPDATE landing_projects SET image_url = '/media/landing-project-stella-vista.jpg', updated_at = datetime('now') WHERE title_en = 'Stella Vista';
UPDATE landing_projects SET image_url = '/media/landing-project-gerlug.jpg',       updated_at = datetime('now') WHERE title_en = 'Gerlug Vista';
UPDATE landing_projects SET image_url = '/media/landing-project-zaisan.jpg',       updated_at = datetime('now') WHERE title_en = 'Zaisan Multi-purpose Building';
UPDATE landing_projects SET image_url = '/media/landing-project-kaidu-mall.jpg',   updated_at = datetime('now') WHERE title_en = 'Kaidu Mall — Cinema Next';
UPDATE landing_projects SET image_url = '/media/landing-project-toyota.jpg',       updated_at = datetime('now') WHERE title_en = 'TOYOTA Showroom';
UPDATE landing_projects SET image_url = '/media/landing-project-nukht-naran.jpg',  updated_at = datetime('now') WHERE title_en = 'NUKTH Naran Clubhouse';
UPDATE landing_projects SET image_url = '/media/landing-project-encanto.jpg',      updated_at = datetime('now') WHERE title_en = 'Encanto Trade Center';
